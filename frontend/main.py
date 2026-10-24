import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
        app.state.http_client = client
        yield


app = FastAPI(lifespan=lifespan)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=20_000)


class AskResponse(BaseModel):
    answer: str


@app.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, request: Request) -> AskResponse:
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question must not be blank.")

    api_key = os.environ.get("NICRRON_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service is not configured.")

    try:
        response = await request.app.state.http_client.post(
            "https://api.nicrron.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "nicrron/auto",
                "messages": [{"role": "user", "content": question}],
                "stream": False,
            },
        )
        response.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI service timed out.") from None
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="AI service request failed.") from None

    try:
        answer = response.json()["choices"][0]["message"]["content"]
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("Missing answer")
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(status_code=502, detail="AI service returned an invalid answer.") from None

    # Never return a credential even if an upstream response echoes it.
    return AskResponse(answer=answer.replace(api_key, "[REDACTED]"))
