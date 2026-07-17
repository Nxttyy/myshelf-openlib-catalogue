"""
S3-compatible object storage — comment photo uploads.

Clients upload straight to the bucket via a presigned POST policy (size +
content-type enforced by S3 itself); the backend never sees the bytes. Works
against any S3-compatible endpoint (AWS, MinIO, R2, B2, Wasabi, ...) since the
endpoint is fully configurable and addressing is path-style.
"""

import uuid
from functools import lru_cache

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError
from fastapi import HTTPException

from app.config import settings

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}
MAX_BYTES = 10 * 1024 * 1024  # 10MB
MAX_IMAGES_PER_BOOK = 6
PRESIGN_EXPIRY_SECONDS = 300
# Read URLs are embedded in server-rendered pages, so they need to outlive a
# normal browsing session — the bucket isn't public-read, so every <img src>
# has to be a presigned GET.
GET_PRESIGN_EXPIRY_SECONDS = 3600


def storage_configured() -> bool:
    return bool(
        settings.S3_ENDPOINT_URL
        and settings.S3_BUCKET
        and settings.S3_ACCESS_KEY
        and settings.S3_SECRET_KEY
    )


def require_storage_configured() -> None:
    if not storage_configured():
        raise HTTPException(status_code=503, detail="Photo storage is not configured")


@lru_cache
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def new_key(content_type: str) -> str:
    ext = {
        "image/jpeg": "jpg", "image/png": "png",
        "image/webp": "webp", "image/heic": "heic",
    }.get(content_type, "bin")
    return f"comment-photos/{uuid.uuid4()}.{ext}"


def presign_post(key: str, content_type: str) -> dict:
    """Presigned POST policy: caps size and pins content-type, enforced by S3."""
    return _client().generate_presigned_post(
        Bucket=settings.S3_BUCKET,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, MAX_BYTES],
        ],
        ExpiresIn=PRESIGN_EXPIRY_SECONDS,
    )


def head_object(key: str) -> dict | None:
    try:
        return _client().head_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError:
        return None


def delete_object(key: str) -> None:
    _client().delete_object(Bucket=settings.S3_BUCKET, Key=key)


def presigned_get_url(key: str, expires_in: int = GET_PRESIGN_EXPIRY_SECONDS) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )
