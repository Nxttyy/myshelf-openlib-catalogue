"""
Note photos, shared by book and film shelf entries. Each photo row
(UserBookImage) hangs off exactly one entry: `user_book_id` or
`user_film_id`, named here by `owner`.

Flow: presign (rows created as pending) → the client POSTs the bytes
straight to the bucket → confirm (checks the object landed) → uploaded.
"""

from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from sqlmodel import select

from app.db import SessionDep
from app.models.user_book_image import UserBookImage
from app.schemas.user_book_image import PresignBatchRequest, PresignedUpload, UserBookImageRead
from app.services import storage

Owner = Literal["user_book_id", "user_film_id"]


def _column(owner: Owner):
    return getattr(UserBookImage, owner)


async def presign(session: SessionDep, owner: Owner, entry_id: UUID, request_data: PresignBatchRequest) -> list[PresignedUpload]:
    """Issue a presigned upload for each requested file; the client PUTs the
    bytes straight to the bucket, then confirms each one."""
    storage.require_storage_configured()
    existing_count = len((await session.exec(
        select(UserBookImage.id).where(_column(owner) == entry_id)
    )).all())
    if existing_count + len(request_data.files) > storage.MAX_IMAGES_PER_BOOK:
        raise HTTPException(
            status_code=422,
            detail=f"A note can have at most {storage.MAX_IMAGES_PER_BOOK} photos",
        )

    results: list[PresignedUpload] = []
    for i, file in enumerate(request_data.files):
        if file.content_type not in storage.ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=422, detail=f"Unsupported image type: {file.content_type}")
        if file.byte_size <= 0 or file.byte_size > storage.MAX_BYTES:
            raise HTTPException(status_code=422, detail="Image is too large")

        key = storage.new_key(file.content_type)
        image = UserBookImage(
            **{owner: entry_id},
            s3_key=key,
            content_type=file.content_type,
            byte_size=file.byte_size,
            position=existing_count + i,
            status="pending",
        )
        session.add(image)
        await session.commit()
        await session.refresh(image)

        post = storage.presign_post(key, file.content_type)
        results.append(PresignedUpload(
            image_id=image.id, key=key,
            upload_url=post["url"], fields=post["fields"],
        ))
    return results


async def _image(session: SessionDep, owner: Owner, entry_id: UUID, image_id: UUID) -> UserBookImage:
    image = await session.get(UserBookImage, image_id)
    if not image or getattr(image, owner) != entry_id:
        raise HTTPException(status_code=404, detail="Image not found")
    return image


async def confirm(session: SessionDep, owner: Owner, entry_id: UUID, image_id: UUID) -> UserBookImageRead:
    storage.require_storage_configured()
    image = await _image(session, owner, entry_id, image_id)

    head = storage.head_object(image.s3_key)
    if not head:
        raise HTTPException(status_code=422, detail="Upload not found in storage yet")

    image.status = "uploaded"
    session.add(image)
    # Capture fields before commit: commit expires the ORM object's attributes,
    # and touching them afterwards triggers lazy IO outside the async greenlet
    # (the "greenlet_spawn" error).
    image_id_, s3_key, position = image.id, image.s3_key, image.position
    await session.commit()
    return UserBookImageRead(id=image_id_, url=storage.presigned_get_url(s3_key), position=position)


async def delete(session: SessionDep, owner: Owner, entry_id: UUID, image_id: UUID) -> None:
    storage.require_storage_configured()
    image = await _image(session, owner, entry_id, image_id)
    storage.delete_object(image.s3_key)
    await session.delete(image)
    await session.commit()


async def attach(session: SessionDep, owner: Owner, items: list[dict], entry_key: str) -> None:
    """Set item["images"] (uploaded photos, ordered) on each item, keyed off
    the id of item[entry_key] (a UserBook or UserFilm)."""
    for item in items:
        item["images"] = []
    if not items or not storage.storage_configured():
        return
    ids = [item[entry_key].id for item in items]
    result = await session.exec(
        select(UserBookImage)
        .where(_column(owner).in_(ids), UserBookImage.status == "uploaded")
        .order_by(UserBookImage.position)
    )
    by_entry: dict = {}
    for img in result.all():
        by_entry.setdefault(getattr(img, owner), []).append(
            {"id": str(img.id), "url": storage.presigned_get_url(img.s3_key), "position": img.position}
        )
    for item in items:
        item["images"] = by_entry.get(item[entry_key].id, [])
