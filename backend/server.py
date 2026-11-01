from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone

import httpx
import binascii
import io
from PIL import Image, UnidentifiedImageError
from fastapi.staticfiles import StaticFiles


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ===== Models =====
class GenerateRequest(BaseModel):
    image1_base64: str = Field(max_length=14000000)
    image2_base64: str = Field(max_length=14000000)
    prompt: str = Field(min_length=1, max_length=4000)
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{16,100}$")


class Creation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    prompt: str
    result_image_base64: str
    mime_type: str = "image/png"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CreationSummary(BaseModel):
    id: str
    prompt: str
    result_image_base64: str
    mime_type: str
    created_at: datetime


# ===== Helpers =====
def _strip_data_url(b64: str) -> str:
    if b64.startswith("data:"):
        # data:image/png;base64,XXXX
        return b64.split(",", 1)[-1]
    return b64


# ===== Routes =====
@api_router.get("/")
async def root():
    return {"message": "Star In Your Own Scene API"}


@api_router.post("/generate-photo", response_model=CreationSummary)
async def generate_photo(payload: GenerateRequest):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Set GEMINI_API_KEY on the server to enable photo editing.")
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Describe the photo edit you want.")
    parts = [{"text": prompt}]
    for value in (payload.image1_base64, payload.image2_base64):
        try:
            raw = base64.b64decode(_strip_data_url(value), validate=True)
            if len(raw) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Each photo must be under 10 MB.")
            with Image.open(io.BytesIO(raw)) as photo:
                if photo.width * photo.height > 25000000:
                    raise HTTPException(status_code=413, detail="Use a photo under 25 megapixels.")
                mime = Image.MIME.get(photo.format)
                photo.verify()
            if mime not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("Unsupported image")
        except (ValueError, binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
            raise HTTPException(status_code=400, detail="Upload a valid JPEG, PNG, or WebP photo.") from exc
        parts.append({"inlineData": {"mimeType": mime, "data": base64.b64encode(raw).decode()}})
    model = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")
    try:
        async with httpx.AsyncClient(timeout=150) as http:
            response = await http.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": api_key},
                json={"contents": [{"parts": parts}], "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}},
            )
        if response.status_code != 200:
            logger.warning("Image provider returned status %s", response.status_code)
            detail = "Image service quota reached. Check your Gemini quota and billing." if response.status_code == 429 else "Image service could not complete the edit. Check the server API key and model."
            raise HTTPException(status_code=502, detail=detail)
        result = response.json()
        output = next((part["inlineData"] for candidate in result.get("candidates", [])
                       for part in candidate.get("content", {}).get("parts", [])
                       if part.get("inlineData", {}).get("mimeType", "").startswith("image/")), None)
        if not output or not output.get("data"):
            raise HTTPException(status_code=422, detail="The image service returned no edited photo. Try different photos or revise the instructions.")
        result_b64 = output["data"]
        mime_type = output["mimeType"]
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Photo editing timed out. Please try again.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="The image service is unavailable. Please try again.") from exc

    creation = Creation(
        prompt=prompt,
        result_image_base64=result_b64,
        mime_type=mime_type,
    )
    doc = creation.model_dump()
    doc["session_id"] = payload.session_id
    doc["created_at"] = doc["created_at"].isoformat()
    await db.creations.insert_one(doc)

    return CreationSummary(**creation.model_dump())


@api_router.get("/creations", response_model=List[CreationSummary])
async def list_creations(session_id: str):
    docs = await db.creations.find({"session_id": session_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    out: List[CreationSummary] = []
    for d in docs:
        if isinstance(d.get("created_at"), str):
            d["created_at"] = datetime.fromisoformat(d["created_at"])
        out.append(CreationSummary(**d))
    return out


@api_router.delete("/creations/{creation_id}")
async def delete_creation(creation_id: str, session_id: str):
    res = await db.creations.delete_one({"id": creation_id, "session_id": session_id})
    return {"deleted": res.deleted_count}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()


@app.get("/health")
async def health():
    return {"status": "online", "image_provider_ready": bool(os.environ.get("GEMINI_API_KEY"))}

frontend_build = ROOT_DIR.parent / "frontend" / "build"
if frontend_build.is_dir():
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")
