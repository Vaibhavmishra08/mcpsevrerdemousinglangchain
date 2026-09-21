import asyncio
import os
import sys
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_core.messages import HumanMessage, ToolMessage

load_dotenv()

FALLBACK_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-3.6-flash"
]

async def process_query(prompt: str, tools, api_key: str):
    print(f"\nUser Prompt: {prompt}\n")
    
    last_error = None
    for model_name in FALLBACK_MODELS:
        try:
            llm = ChatGoogleGenerativeAI(
                model=model_name,
                google_api_key=api_key,
                temperature=0
            ).bind_tools(tools)
            
            ai_msg = await llm.ainvoke(prompt)

            if ai_msg.tool_calls:
                for tool_call in ai_msg.tool_calls:
                    print(f"[{model_name}] Requested tool call: '{tool_call['name']}' with args: {tool_call['args']}")
                    
                    # Find matching tool loaded from MCP and invoke it
                    matching_tool = next((t for t in tools if t.name == tool_call['name']), None)
                    if matching_tool:
                        tool_output = await matching_tool.ainvoke(tool_call['args'])
                        print(f"[MCP Server Output]:\n{tool_output}\n")

                        # Send tool output back to Gemini to get the final response
                        messages = [
                            HumanMessage(content=prompt),
                            ai_msg,
                            ToolMessage(content=str(tool_output), tool_call_id=tool_call.get("id", "call_1"))
                        ]
                        
                        final_res = await llm.ainvoke(messages)
                        answer = final_res.content
                        if isinstance(answer, list):
                            answer = "\n".join([item.get("text", str(item)) if isinstance(item, dict) else str(item) for item in answer])
                        print(f"[{model_name} Final Answer]:\n{answer}\n")
                        return
            else:
                answer = ai_msg.content
                if isinstance(answer, list):
                    answer = "\n".join([item.get("text", str(item)) if isinstance(item, dict) else str(item) for item in answer])
                print(f"[{model_name} Answer]:\n{answer}\n")
                return

        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                print(f"[RATE LIMIT] Model '{model_name}' quota exhausted. Trying next fallback model...")
                last_error = e
                continue
            else:
                print(f"[ERROR] Error with model '{model_name}': {e}")
                raise e

    if last_error:
        print(f"\n[ALERT] All candidate Gemini models exceeded quota (429 RESOURCE_EXHAUSTED).\nDetails: {last_error}")

async def main():
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_gemini_api_key_here":
        print("[WARNING] GOOGLE_API_KEY is missing in your .env file.")
        print("Please edit .env file and set your key: GOOGLE_API_KEY=your_key_here\n")
        return

    # 1. Initialize MultiServerMCPClient
    client = MultiServerMCPClient(
        {
            "weather": {
                "command": "uv",
                "args": ["run", "weather.py"],
                "transport": "stdio",
            }
        }
    )

    # 2. Get tools from the MCP server
    tools = await client.get_tools()

    # Check if prompt was provided directly via command-line arguments
    if len(sys.argv) > 1:
        user_prompt = " ".join(sys.argv[1:])
        await process_query(user_prompt, tools, api_key)
        return

    # Interactive mode loop
    print("=== Weather Agent Interactive Terminal ===")
    print("Type your weather question below (or 'exit' / 'quit' to exit).\n")

    while True:
        try:
            prompt = await asyncio.to_thread(input, "Ask Gemini > ")
            prompt = prompt.strip()
            if not prompt:
                continue
            if prompt.lower() in ("exit", "quit"):
                print("Goodbye!")
                break
            await process_query(prompt, tools, api_key)
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            break

if __name__ == "__main__":
    asyncio.run(main())
