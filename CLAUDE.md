# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Start development server**: `npm run dev` (uses nodemon for auto-restart)
- **Start production server**: `npm start`
- **No testing framework configured** - tests should be added if needed

## Architecture Overview

This is a Node.js/Express API for a Scout organization management system that handles participants, events, badges, and administrative tasks.

### Core Structure

- **Entry Point**: `index.js` - Main Express app with middleware, CORS, and route registration
- **Routes**: Split into public (`/routes/public.js`) and protected API routes (`/routes/api.js`)
- **Controllers**: Domain-specific controllers in `/controllers/` directory for each feature area
- **Database**: PostgreSQL with connection pooling via `/config/database.js`
- **Middleware**: Custom middleware in `/middleware/` and shared middleware in `/config/middleware.js`

### Key Features

- **Multi-organization support** with organization context middleware
- **JWT authentication** with role-based access control (parent, animation, admin)
- **Comprehensive validation** using express-validator for all API endpoints
- **Database transactions** supported via the database configuration
- **Logging** via Winston logger in `/config/logger.js`

### Database Connection

- Uses PostgreSQL connection pool with environment variables
- Connection string via `DB_URL` or `DATABASE_URL` environment variable
- Automatic SSL configuration for production environments
- Connection pooling with configurable limits and timeouts

### Organization Context

- Every request is processed within an organization context
- Organization ID determined from JWT tokens, headers, or request parameters
- Middleware automatically adds organization context to requests
- Most database operations are scoped to the current organization

### Authentication & Authorization

- JWT-based authentication with refresh token support
- Three user roles: `parent`, `animation`, `admin`
- Role-based middleware for protecting endpoints
- Email verification and password reset functionality

### Project Conventions

- Files must not exceed 150 lines (split into separate files if needed)
- No comments in code - code should be self-explanatory
- Follow KISS and DRY principles
- Surgical modifications - reuse existing functions rather than creating new ones
- Modular architecture with clear separation of concerns
- Deterministic operations preferred over async complexity