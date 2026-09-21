# pyrefly: ignore [missing-import]
from mcp.server.fastmcp import FastMCP
mcp=FastMCP("Maths")
@mcp.tool()
def add(a:int,b:int)->int:
    return a+b
@mcp.tool()
def sub(a:int,b:int)->int:
    return a-b
@mcp.tool()
def mul(a:int,b:int)->int:
    return a*b
@mcp.tool()
def div(a:int,b:int)->int:
    return a//b
@mcp.tool()
def power(a:int,b:int)->int:
    return a**b
@mcp.tool()
def mod(a:int,b:int)->int:
    return a%b
# async def main()->None:
#     async with aiofiles.open("mathserver.json","w")as f:
#         await f.write(json.dumps(mcp.metadata,indent=2))
#     async with Fast

#the transport="stdio" means that it will run in the terminal where the python is executed using the commnad python mathserver.py
#the transport="http" means that it will run in the terminal where the python is executed using the commnad python mathserver.py 
if __name__== "__main__":
    mcp.run(transport="stdio") 