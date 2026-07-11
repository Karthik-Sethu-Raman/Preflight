Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -Command `"cd 'd:\e\College\Project\CLoud Preflight\Preflight\backend'; pip install -r requirements.txt; uvicorn main:app --host 0.0.0.0 --port 8000`""
Start-Process powershell -ArgumentList "-NoExit -ExecutionPolicy Bypass -Command `"cd 'd:\e\College\Project\CLoud Preflight\Preflight\frontend'; npm run dev`""
