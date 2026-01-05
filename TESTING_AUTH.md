# 🧪 Testing the Authentication System

## Prerequisites

1. Make sure PostgreSQL is running
2. Update your `.env` file with database credentials and JWT secret
3. Start the backend server

## Starting the Server

```bash
cd backend
npm run start:dev
```

The server should start on `http://localhost:3000`

## Test Endpoints

### 1. Register a New User

**Request:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

**Expected Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "john@example.com",
    "roles": ["user"],
    "number_of_videos_generated": 0,
    "number_of_images_generated": 0,
    "number_of_voices_generated": 0,
    "created_at": "2025-12-26T10:30:00.000Z",
    "updated_at": "2025-12-26T10:30:00.000Z"
  }
}
```

### 2. Login with Existing User

**Request:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

**Expected Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "john@example.com",
    "roles": ["user"],
    "number_of_videos_generated": 0,
    "number_of_images_generated": 0,
    "number_of_voices_generated": 0,
    "created_at": "2025-12-26T10:30:00.000Z",
    "updated_at": "2025-12-26T10:30:00.000Z"
  }
}
```

### 3. Get Current User Profile (Protected Route)

**Request:**
```bash
# Replace YOUR_TOKEN_HERE with the access_token from login/register
curl -X GET http://localhost:3000/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Expected Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "john@example.com",
  "roles": ["user"],
  "number_of_videos_generated": 0,
  "number_of_images_generated": 0,
  "number_of_voices_generated": 0,
  "created_at": "2025-12-26T10:30:00.000Z",
  "updated_at": "2025-12-26T10:30:00.000Z"
}
```

## Error Cases to Test

### 1. Register with Existing Email

**Request:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

**Expected Response (409 Conflict):**
```json
{
  "statusCode": 409,
  "message": "Email already exists"
}
```

### 2. Login with Wrong Password

**Request:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "wrongpassword"
  }'
```

**Expected Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Invalid credentials"
}
```

### 3. Access Protected Route Without Token

**Request:**
```bash
curl -X GET http://localhost:3000/auth/me
```

**Expected Response (401 Unauthorized):**
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 4. Invalid Email Format

**Request:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "not-an-email",
    "password": "password123"
  }'
```

**Expected Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": ["email must be an email"],
  "error": "Bad Request"
}
```

### 5. Password Too Short

**Request:**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "123"
  }'
```

**Expected Response (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": ["Password must be at least 6 characters long"],
  "error": "Bad Request"
}
```

## Using Postman

1. **Import Collection:**
   - Create a new collection called "Auto Video Generator"
   - Add the three endpoints above

2. **Environment Variables:**
   - Create a variable `baseUrl` = `http://localhost:3000`
   - Create a variable `token` (will be set automatically)

3. **Auto-save Token:**
   In the "Tests" tab of register/login requests, add:
   ```javascript
   pm.environment.set("token", pm.response.json().access_token);
   ```

4. **Use Token in Protected Routes:**
   In the Authorization tab, select "Bearer Token" and use `{{token}}`

## Database Verification

Check if user was created in PostgreSQL:

```sql
SELECT id, email, roles, created_at FROM users;
```

Check password is hashed:

```sql
SELECT password FROM users WHERE email = 'john@example.com';
-- Should see a bcrypt hash like: $2b$10$...
```

## ✅ Success Checklist

- [ ] Can register a new user
- [ ] Receives JWT token after registration
- [ ] Can login with correct credentials
- [ ] Cannot register with duplicate email
- [ ] Cannot login with wrong password
- [ ] Can access `/auth/me` with valid token
- [ ] Cannot access `/auth/me` without token
- [ ] Password is hashed in database
- [ ] Email validation works
- [ ] Password length validation works

## Next Steps

Once authentication is working:
1. Create controllers/services for other modules
2. Protect routes that need authentication
3. Use `@GetUser()` decorator to access current user
4. Implement role-based authorization if needed

