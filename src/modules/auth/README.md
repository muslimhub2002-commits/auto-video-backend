# Authentication Module

JWT-based authentication system with email and password.

## Endpoints

### 1. Register
**POST** `/auth/register`

Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "roles": ["user"],
    "number_of_videos_generated": 0,
    "number_of_images_generated": 0,
    "number_of_voices_generated": 0,
    "created_at": "2025-12-26T10:00:00.000Z",
    "updated_at": "2025-12-26T10:00:00.000Z"
  }
}
```

### 2. Login
**POST** `/auth/login`

Authenticate an existing user.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "roles": ["user"],
    "number_of_videos_generated": 0,
    "number_of_images_generated": 0,
    "number_of_voices_generated": 0,
    "created_at": "2025-12-26T10:00:00.000Z",
    "updated_at": "2025-12-26T10:00:00.000Z"
  }
}
```

### 3. Get Profile
**GET** `/auth/me`

Get the authenticated user's profile.

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "roles": ["user"],
  "number_of_videos_generated": 0,
  "number_of_images_generated": 0,
  "number_of_voices_generated": 0,
  "created_at": "2025-12-26T10:00:00.000Z",
  "updated_at": "2025-12-26T10:00:00.000Z"
}
```

## Usage in Other Modules

### Protect Routes with JWT Guard

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('videos')
export class VideosController {
  @Get()
  @UseGuards(JwtAuthGuard)
  async getMyVideos(@GetUser() user: User) {
    // user is automatically injected from JWT token
    console.log(user.id, user.email);
    return { message: 'Protected route' };
  }
}
```

## Environment Variables

Add these to your `.env` file:

```env
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRATION=7d
```

## Security Features

- ✅ Password hashing with bcrypt (salt rounds: 10)
- ✅ JWT token-based authentication
- ✅ Email uniqueness validation
- ✅ Password minimum length validation (6 characters)
- ✅ Protected routes with JWT guard
- ✅ User decorator for easy access to authenticated user

