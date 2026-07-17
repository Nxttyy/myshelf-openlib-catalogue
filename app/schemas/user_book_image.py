"""
Pydantic schemas for UserBookImage — comment photo upload API.
"""

from uuid import UUID

from pydantic import BaseModel


class ImagePresignRequest(BaseModel):
    content_type: str
    byte_size: int


class PresignBatchRequest(BaseModel):
    files: list[ImagePresignRequest]


class PresignedUpload(BaseModel):
    image_id: UUID
    key: str
    upload_url: str
    fields: dict


class UserBookImageRead(BaseModel):
    id: UUID
    url: str
    position: int

    model_config = {"from_attributes": True}
