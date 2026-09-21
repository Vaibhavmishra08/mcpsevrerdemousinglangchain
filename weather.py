import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Weather")

@mcp.tool()
async def get_weather(city: str) -> str:
    """Get exact live weather data for a given city name."""
    async with httpx.AsyncClient() as client:
        # Step 1: Get latitude and longitude for the city
        geo_res = await client.get(
            f"https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1"
        )
        geo_data = geo_res.json()
        
        if not geo_data.get("results"):
            return f"Could not find coordinates for city: {city}"
        
        location = geo_data["results"][0]
        lat = location["latitude"]
        lon = location["longitude"]
        city_name = location["name"]
        country = location.get("country", "")

        # Step 2: Fetch current weather data
        weather_res = await client.get(
            f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true"
        )
        weather_data = weather_res.json()
        current = weather_data.get("current_weather", {})
        
        temp_c = current.get("temperature")
        windspeed = current.get("windspeed")

        return (
            f"Current weather in {city_name}, {country}:\n"
            f"- Temperature: {temp_c}°C\n"
            f"- Wind Speed: {windspeed} km/h"
        )

if __name__ == "__main__":
    mcp.run(transport="stdio")
