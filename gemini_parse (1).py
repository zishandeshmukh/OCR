import os
import json
from google.genai import types

# ----------------------------------------------------
# GEMINI FULL PAGE MULTI-RECORD PARSER (CALL 2)
# ----------------------------------------------------
def parse_full_page_voters(client, contents_list, page_key):
    """
    Analyzes image contents (passed as list of Parts/Bytes) and extracts a list of all voter records.
    """
    
    # Voter Record Structure (Schema)
    voter_schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "VoterStatus": types.Schema(type=types.Type.STRING, description="Status of the voter ('ALIVE', 'DELETED', or 'DUPLICATE')."), 
            "ACNo": types.Schema(type=types.Type.STRING), 
            "PartNo_Segment": types.Schema(type=types.Type.STRING),
            "SerialNoInPart": types.Schema(type=types.Type.STRING),
            "SrNo": types.Schema(type=types.Type.STRING),
            "EPIC": types.Schema(type=types.Type.STRING),
            "FullName_M": types.Schema(type=types.Type.STRING, description="Voter's full name in Marathi."),
            # 🔴 CHANGE: FullName_E expects N/A/Blank from AI (Local Transliteration)
            "FullName_E": types.Schema(type=types.Type.STRING, description="Set this field to N/A or empty string."),
            "RelationType": types.Schema(type=types.Type.STRING, description="Father, Husband, or Mother."),
            "RelationName_M": types.Schema(type=types.Type.STRING),
            # 🟢 NEW: RelationName_E expects N/A/Blank from AI (Local Transliteration)
            "RelationName_E": types.Schema(type=types.Type.STRING, description="Set this field to N/A or empty string."),
            "HouseNo": types.Schema(type=types.Type.STRING),
            "Age": types.Schema(type=types.Type.STRING),
            "Sex": types.Schema(type=types.Type.STRING),
        },
        required=["VoterStatus", "ACNo", "PartNo_Segment", "SerialNoInPart", "SrNo", "EPIC", 
                  "FullName_M", "FullName_E", "RelationType", "RelationName_M", "RelationName_E", "HouseNo", "Age", "Sex"] 
    )

    # JSON Array Output Schema
    schema = types.Schema(
        type=types.Type.ARRAY,
        items=voter_schema
    )

    prompt = f"""
    Analyze the provided full-page image of the electoral roll (Page {page_key}). 
    Your primary task is to extract EVERY SINGLE VOTER RECORD from the tabular data area.
    
    Instructions:
    1. Extract all required voter fields (SrNo, EPIC, FullName_M, RelationName_M, etc.) and determine VoterStatus (ALIVE, DELETED, DUPLICATE).
    2. **CRITICAL: Set FullName_E and RelationName_E fields to 'N/A' or an empty string.** Do not attempt any transliteration.
    3. Output strictly a JSON array (list of JSON objects).
    """
    
    # API Call
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt] + contents_list, # Add prompt and image part(s)
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )

        parsed_json = json.loads(response.text)
        return parsed_json, response.usage_metadata
        
    except Exception as e:
        return {"Error": f"Gemini API call for Voter Records failed: {e}. Ensure the image resolution is clear."}, None

# ----------------------------------------------------
# 🟢 CALL 1: HEADER STRUCTURE & PAGE NUMBER (Cost Optimized)
# ----------------------------------------------------
def process_header_footer_gemini(client, image_bytes, type_of_block="COMBINED_HEADER"):
    """
    Extracts Raw Header text, parses it into structured data, and extracts the Page Number in a single API call.
    """
    if type_of_block != "COMBINED_HEADER":
        return {"Error": "Incorrect type_of_block."}, None

    # COMBINED OUTPUT SCHEMA: Returns all structured header fields + Page Number
    combined_schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "GAT_and_Gan_Detals": types.Schema(type=types.Type.STRING, description="Extract the Election Division/Constituency details."),
            "PartNo": types.Schema(type=types.Type.STRING, description="Extract the Part Number and the locality/village name."),
            "BootName": types.Schema(type=types.Type.STRING, description="Extract the Polling Station Name."),
            "BoothaAddress": types.Schema(type=types.Type.STRING, description="Extract the full address of the polling station."),
            "Page_Number": types.Schema(type=types.Type.STRING, description="The page number from the footer, converted to English digits.")
        },
        required=["GAT_and_Gan_Detals", "PartNo", "BootName", "BoothaAddress", "Page_Number"]
    )
    
    prompt = """
    Analyze the provided full-page electoral roll image. 
    Your task is to extract the header text and the page number from the footer, and structure this information directly into the JSON schema provided.
    
    Instructions:
    1. Extract ALL Header fields (GAT_and_Gan_Detals, PartNo, BootName, BoothaAddress) from the text above the main voter data area.
    2. Extract the Page_Number from the footer. Convert Devanagari digits to English.
    3. Crucial: DO NOT read or transcribe the tabular voter data (voter names, EPIC numbers, Sr No, Age/Sex). Focus solely on the header and footer metadata.
    """
    
    image_part = types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg') 

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[prompt, image_part],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=combined_schema,
            ),
        )
        
        data = json.loads(response.text)
        return data, response.usage_metadata
        
    except Exception as e:
        return {"Error": f"Gemini API call for Combined Header/Structure failed: {e}"}, None


# ----------------------------------------------------
# MAIN ENTRY POINT
# ----------------------------------------------------
if __name__ == "__main__":
    from google import genai
    
    # Configure API key - set your GOOGLE_API_KEY environment variable or replace below
    api_key = os.environ.get("GOOGLE_API_KEY")
    
    if not api_key:
        print("ERROR: Please set your GOOGLE_API_KEY environment variable.")
        print("Example: $env:GOOGLE_API_KEY = 'your-api-key-here'")
        exit(1)
    
    client = genai.Client(api_key=api_key)
    print("Gemini client initialized successfully!")
    print("\nThis module provides two functions:")
    print("  1. parse_full_page_voters(client, contents_list, page_key) - Extract voter records from images")
    print("  2. process_header_footer_gemini(client, image_bytes) - Extract header/footer metadata")
    print("\nTo use, provide an electoral roll image file path as argument.")
    
    # Check if an image path was provided
    import sys
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
        if os.path.exists(image_path):
            print(f"\nProcessing image: {image_path}")
            with open(image_path, "rb") as f:
                image_bytes = f.read()
            
            # Process header/footer
            print("\n--- Extracting Header & Page Number ---")
            header_data, usage = process_header_footer_gemini(client, image_bytes, "COMBINED_HEADER")
            print(json.dumps(header_data, indent=2, ensure_ascii=False))
            
            # Process voter records
            print("\n--- Extracting Voter Records ---")
            from google.genai import types
            image_part = types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg')
            voters, usage = parse_full_page_voters(client, [image_part], "1")
            print(json.dumps(voters, indent=2, ensure_ascii=False))
        else:
            print(f"ERROR: Image file not found: {image_path}")
    else:
        print("\nUsage: python 'gemini_parse (1).py' <image_path>")
        print("Example: python 'gemini_parse (1).py' electoral_roll.jpg")