import sys
import os
import re
import asyncio
from contextlib import asynccontextmanager
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import HumanMessage, ToolMessage

load_dotenv()

# Global state holders
mcp_client = None
mcp_tools = []
current_api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or ""

SUPPORTED_MODELS = [
    {"id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash", "description": "Gemini 3.7 Flash generation"},
    {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash", "description": "Stable Gemini 3.5 Flash"},
    {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite", "description": "Lightweight & low latency"},
    {"id": "gemini-3.1-flash-lite", "name": "Gemini 3.1 Flash Lite", "description": "Fast Flash Lite model"},
    {"id": "gemini-flash-latest", "name": "Gemini Flash Latest", "description": "Alias for latest Flash model"},
    {"id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash", "description": "Gemini 3.6 Flash"}
]

DEFAULT_MODEL = "gemini-3.1-flash-lite"

def get_llm(model_name: str = DEFAULT_MODEL, api_key: Optional[str] = None):
    key = api_key or current_api_key or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not key or key == "your_gemini_api_key_here":
        raise HTTPException(
            status_code=400,
            detail="GOOGLE_API_KEY is not configured. Please set your API key in .env or the Settings dialog."
        )
    return ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=key,
        temperature=0
    ).bind_tools(mcp_tools)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global mcp_client, mcp_tools, current_api_key
    
    current_api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or ""
    if not current_api_key or current_api_key == "your_gemini_api_key_here":
        print("[WARNING] GOOGLE_API_KEY is missing or unconfigured in .env file.")
    
    try:
        # Initialize MultiServerMCPClient using current python runtime
        python_exe = sys.executable or "python"
        mcp_client = MultiServerMCPClient(
            {
                "weather": {
                    "command": python_exe,
                    "args": ["weather.py"],
                    "transport": "stdio",
                }
            }
        )

        # Retrieve available tools
        mcp_tools = await mcp_client.get_tools()
        print(f"[INFO] MCP Agent initialized successfully with {len(mcp_tools)} tools.")
    except Exception as e:
        print(f"[ERROR] Failed to initialize MCP Agent: {e}")

    yield

    # Cleanup
    mcp_tools.clear()

app = FastAPI(title="LangChain MCP Agent API", lifespan=lifespan)

class ChatRequest(BaseModel):
    message: str
    model: Optional[str] = None
    api_key: Optional[str] = None

class ApiKeyUpdate(BaseModel):
    api_key: str

@app.get("/api/models")
async def get_models():
    return {
        "models": SUPPORTED_MODELS,
        "default": DEFAULT_MODEL
    }

@app.get("/api/status")
async def get_status():
    tools_info = []
    for tool in mcp_tools:
        tools_info.append({
            "name": tool.name,
            "description": tool.description or "No description provided."
        })
    
    key_configured = bool(current_api_key and current_api_key != "your_gemini_api_key_here")
    
    return {
        "status": "online",
        "default_model": DEFAULT_MODEL,
        "api_key_configured": key_configured,
        "mcp_servers": ["weather.py (stdio)"],
        "tools": tools_info,
        "available_models": SUPPORTED_MODELS
    }

@app.post("/api/config/key")
async def set_api_key(payload: ApiKeyUpdate):
    global current_api_key
    key = payload.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty.")
    
    current_api_key = key
    os.environ["GOOGLE_API_KEY"] = key
    return {"status": "success", "message": "API key updated successfully."}

def parse_rate_limit_error(err_str: str) -> dict:
    """Helper to detect 429 quota exhaustion and parse retry delay."""
    is_429 = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota exceeded" in err_str
    if not is_429:
        return {"is_rate_limit": False}
    
    # Extract retry delay if available
    match = re.search(r"retry in (\d+(\.\d+)?)s|retryDelay': '(\d+)s'", err_str, re.IGNORECASE)
    retry_delay = 30
    if match:
        retry_delay = int(float(match.group(1) or match.group(3) or 30))
    
    return {
        "is_rate_limit": True,
        "retry_delay": retry_delay,
        "details": "Google Gemini API rate limit or quota exceeded (429 RESOURCE_EXHAUSTED). Free tier accounts have per-minute and per-day quota caps for specific models."
    }

async def execute_agent_chain(llm_instance, prompt: str):
    """Executes the agent tool-calling loop."""
    steps = []
    ai_msg = await llm_instance.ainvoke(prompt)

    if ai_msg.tool_calls:
        for tool_call in ai_msg.tool_calls:
            tool_name = tool_call.get("name")
            tool_args = tool_call.get("args", {})
            
            matching_tool = next((t for t in mcp_tools if t.name == tool_name), None)
            if matching_tool:
                tool_output = await matching_tool.ainvoke(tool_args)
                output_text = str(tool_output)
                steps.append({
                    "tool": tool_name,
                    "args": tool_args,
                    "output": output_text
                })

                messages = [
                    HumanMessage(content=prompt),
                    ai_msg,
                    ToolMessage(content=output_text, tool_call_id=tool_call.get("id", "call_1"))
                ]
                
                final_res = await llm_instance.ainvoke(messages)
                answer = final_res.content
                if isinstance(answer, list):
                    answer = "\n".join([item.get("text", str(item)) if isinstance(item, dict) else str(item) for item in answer])
                
                return steps, answer

    answer = ai_msg.content
    if isinstance(answer, list):
        answer = "\n".join([item.get("text", str(item)) if isinstance(item, dict) else str(item) for item in answer])
    
    return steps, answer

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    prompt = request.message.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt message cannot be empty.")

    requested_model = request.model or DEFAULT_MODEL
    user_api_key = request.api_key or current_api_key

    # Define candidate fallback sequence starting with requested model
    model_candidates = [requested_model]
    for candidate in [m["id"] for m in SUPPORTED_MODELS]:
        if candidate not in model_candidates:
            model_candidates.append(candidate)

    last_error = None
    rate_limit_info = None

    for model_name in model_candidates:
        try:
            llm_instance = get_llm(model_name=model_name, api_key=user_api_key)
            steps, reply = await execute_agent_chain(llm_instance, prompt)
            
            # If fallback model was used, inform frontend
            used_fallback = model_name != requested_model
            return {
                "status": "success",
                "model_used": model_name,
                "fallback_triggered": used_fallback,
                "prompt": prompt,
                "steps": steps,
                "reply": reply
            }

        except HTTPException:
            raise
        except Exception as e:
            err_str = str(e)
            parsed_rate_limit = parse_rate_limit_error(err_str)
            if parsed_rate_limit.get("is_rate_limit"):
                rate_limit_info = parsed_rate_limit
                last_error = err_str
                print(f"[RATE LIMIT] Model {model_name} quota exhausted. Trying next fallback candidate...")
                continue  # Try next model candidate
            else:
                # Non-rate-limit error (e.g. bad request or tool error)
                print(f"[ERROR] Error executing with model {model_name}: {err_str}")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error_type": "agent_error",
                        "message": f"Agent error calling model '{model_name}': {err_str}",
                        "model": model_name
                    }
                )

    # If all model candidates failed due to rate limits:
    if rate_limit_info:
        raise HTTPException(
            status_code=429,
            detail={
                "error_type": "rate_limit_exceeded",
                "message": "Gemini API Rate Limit / Quota Exceeded (429 RESOURCE_EXHAUSTED).",
                "model": requested_model,
                "retry_delay": rate_limit_info.get("retry_delay", 30),
                "suggestion": "Google limits free requests per project. Please wait a few moments or provide your own API key in Settings.",
                "raw_error": last_error[:250] if last_error else ""
            }
        )

    raise HTTPException(status_code=500, detail={"error_type": "unknown", "message": f"Failed to get response: {last_error}"})

# Ensure static directory exists
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
