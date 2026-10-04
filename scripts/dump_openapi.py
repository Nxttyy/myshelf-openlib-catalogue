"""Print the FastAPI OpenAPI schema to stdout — feeds web/'s `npm run gen:api`
without needing a running server."""

import json

from app.main import app

print(json.dumps(app.openapi()))
