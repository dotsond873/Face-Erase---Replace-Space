import os
import sys
import base64
import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
os.environ.setdefault('DB_NAME', 'test_face_erase')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from PIL import Image
from fastapi.testclient import TestClient
import server

client = TestClient(server.app)
SESSION = '12345678-abcd-4321-abcd-123456789012'

def payload():
    image = io.BytesIO()
    Image.new('RGB', (4, 4), 'blue').save(image, format='PNG')
    data = base64.b64encode(image.getvalue()).decode()
    return {'image1_base64': data, 'image2_base64': data, 'prompt': 'Replace the person', 'session_id': SESSION}

def test_missing_key(monkeypatch):
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    assert client.post('/api/generate-photo', json=payload()).status_code == 503

def test_invalid_photo(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    data = payload()
    data['image1_base64'] = 'invalid!'
    assert client.post('/api/generate-photo', json=data).status_code == 400

def test_direct_provider_and_private_archive(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    data = payload()
    class FakeHTTP:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, headers, json):
            assert 'generativelanguage.googleapis.com' in url
            assert headers['x-goog-api-key'] == 'test-key'
            assert json['contents'][0]['parts'][1]['inlineData']['mimeType'] == 'image/png'
            return SimpleNamespace(status_code=200, json=lambda: {'candidates': [{'content': {'parts': [{'inlineData': {'data': data['image1_base64'], 'mimeType': 'image/png'}}]}}]})
    monkeypatch.setattr(server.httpx, 'AsyncClient', lambda **kw: FakeHTTP())
    collection = SimpleNamespace(insert_one=AsyncMock(), delete_one=AsyncMock(return_value=SimpleNamespace(deleted_count=1)))
    monkeypatch.setattr(server, 'db', SimpleNamespace(creations=collection))
    response = client.post('/api/generate-photo', json=data)
    assert response.status_code == 200
    assert response.json()['result_image_base64'] == data['image1_base64']
    assert collection.insert_one.call_args.args[0]['session_id'] == SESSION
    client.delete(f'/api/creations/example?session_id={SESSION}')
    assert collection.delete_one.call_args.args[0] == {'id': 'example', 'session_id': SESSION}


def test_quota_error_is_actionable(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    class FakeHTTP:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs):
            return SimpleNamespace(status_code=429)
    monkeypatch.setattr(server.httpx, 'AsyncClient', lambda **kw: FakeHTTP())
    response = client.post('/api/generate-photo', json=payload())
    assert response.status_code == 502
    assert 'quota' in response.json()['detail']


def test_archive_requires_session():
    assert client.get('/api/creations').status_code == 422
