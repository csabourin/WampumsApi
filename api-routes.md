# API Routes Documentation

## Organization ID Handling - RESOLVED

### ✅ Optimizations Applied

The API organization ID handling inconsistencies have been **successfully resolved**:

1. **Global organization middleware** - All `/api` routes now automatically have organization context via global middleware in `index.js:142-154`
2. **Standardized organization retrieval** - All controllers now use consistent `getOrganizationId(req)` function from `utils/organizationContext.js:14`
3. **Deprecated redundant middleware** - `requireOrganization()` middleware neutralized since organization context is handled globally
4. **Consistent access pattern** - All routes access organization via `req.organizationId` property set by global middleware

### 📈 Performance Benefits

- **Eliminated per-route validation overhead** - Organization context validated once per request
- **Reduced code duplication** - Single organization retrieval pattern across all controllers
- **Improved maintainability** - Centralized organization handling logic
- **Backward compatibility** - Existing middleware kept but deprecated

---

## API Routes Status: ✅ CONSISTENT

All API routes now have **consistent organization context** automatically applied.

### Authentication Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| POST | `/api/login` | ✅ Auto-applied | ✅ Fixed | User login |
| POST | `/api/register` | ✅ Auto-applied | ✅ Fixed | User registration |
| POST | `/api/verify-email` | ✅ Auto-applied | ✅ Fixed | Email verification |
| POST | `/api/request-reset` | ✅ Auto-applied | ✅ Fixed | Password reset request |
| POST | `/api/reset-password` | ✅ Auto-applied | ✅ Fixed | Password reset |
| POST | `/api/refresh-token` | ✅ Auto-applied | ✅ Fixed | Refresh JWT token |
| POST | `/api/logout` | ✅ Auto-applied | ✅ Fixed | User logout |
| GET | `/api/users` | ✅ Auto-applied | ✅ Fixed | Get organization users |
| POST | `/api/check-permission` | ✅ Auto-applied | ✅ Fixed | Check user permissions |
| POST | `/api/approve-user` | ✅ Auto-applied + roleMiddleware(["admin"]) | ✅ Fixed | Approve user registration |
| POST | `/api/update-user-role` | ✅ Auto-applied + roleMiddleware(["admin"]) | ✅ Fixed | Update user role |

### Participant Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/participants` | ✅ Auto-applied | ✅ Fixed | Get all participants |
| GET | `/api/participant/:id` | ✅ Auto-applied | ✅ Fixed | Get single participant |
| GET | `/api/participant-details` | ✅ Auto-applied | ✅ Fixed | Get participant details |
| POST | `/api/save-participant` | ✅ Auto-applied | ✅ Fixed | Save participant data |
| GET | `/api/participant-age` | ✅ Auto-applied | ✅ Fixed | Get participant age report |
| GET | `/api/participants-with-users` | ✅ Auto-applied | ✅ Fixed | Get participants with user links |
| POST | `/api/link-participant-to-organization` | ✅ Auto-applied | ✅ Fixed | Link participant to organization |
| POST | `/api/remove-participant-from-organization` | ✅ Auto-applied + roleMiddleware(["admin"]) | ✅ Fixed | Remove participant from organization |
| POST | `/api/associate-user` | ✅ Auto-applied | ✅ Fixed | Associate user with participant |
| POST | `/api/link-user-participants` | ✅ Auto-applied | ✅ Fixed | Link multiple participants to user |

### Guardian Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/guardians` | ✅ Auto-applied | ✅ Fixed | Get all guardians |
| GET | `/api/guardian-info` | ✅ Auto-applied | ✅ Fixed | Get guardian information |
| GET | `/api/guardians-for-participant` | ✅ Auto-applied | ✅ Fixed | Get guardians for specific participant |
| POST | `/api/save-parent` | ✅ Auto-applied | ✅ Fixed | Save parent/guardian data |
| POST | `/api/save-guardian-form-submission` | ✅ Auto-applied | ✅ Fixed | Save guardian form submission |
| POST | `/api/link-parent-to-participant` | ✅ Auto-applied | ✅ Fixed | Link parent to participant |
| POST | `/api/remove-guardians` | ✅ Auto-applied | ✅ Fixed | Remove guardians from participant |
| GET | `/api/parent-users` | ✅ Auto-applied | ✅ Fixed | Get parent user accounts |
| GET | `/api/parent-dashboard-data` | ✅ Auto-applied | ✅ Fixed | Get parent dashboard data |
| GET | `/api/parent-contact-list` | ✅ Auto-applied | ✅ Fixed | Get parent contact list |

### Group Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/get_groups` | ✅ Auto-applied | ✅ Fixed | Get all groups |
| POST | `/api/add-group` | ✅ Auto-applied | ✅ Fixed | Add new group |
| POST | `/api/remove-group` | ✅ Auto-applied | ✅ Fixed | Remove group |
| POST | `/api/update-group-name` | ✅ Auto-applied | ✅ Fixed | Update group name |
| POST | `/api/update-participant-group` | ✅ Auto-applied | ✅ Fixed | Update participant's group |
| POST | `/api/update-points` | ✅ Auto-applied | ✅ Fixed | Update group/individual points |
| GET | `/api/points-report` | ✅ Auto-applied | ✅ Fixed | Get points report |

### Form Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/form-types` | ✅ Auto-applied | ✅ Fixed | Get available form types |
| GET | `/api/form-structure` | ✅ Auto-applied | ✅ Fixed | Get form structure |
| GET | `/api/form-submission` | ✅ Auto-applied | ✅ Fixed | Get form submission |
| GET | `/api/form-submissions` | ✅ Auto-applied | ✅ Fixed | Get all form submissions |
| POST | `/api/save-form-submission` | ✅ Auto-applied | ✅ Fixed | Save form submission |
| GET | `/api/organization-form-formats` | ✅ Auto-applied | ✅ Fixed | Get organization form formats |
| GET | `/api/fiche-sante` | ✅ Auto-applied | ✅ Fixed | Get health form |
| POST | `/api/save-fiche-sante` | ✅ Auto-applied | ✅ Fixed | Save health form |
| GET | `/api/acceptation-risque` | ✅ Auto-applied | ✅ Fixed | Get risk acceptance form |
| POST | `/api/save-acceptation-risque` | ✅ Auto-applied | ✅ Fixed | Save risk acceptance form |

### Badge Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/badge-progress` | ✅ Auto-applied | ✅ Fixed | Get badge progress |
| POST | `/api/save-badge-progress` | ✅ Auto-applied | ✅ Fixed | Save badge progress |
| GET | `/api/pending-badges` | ✅ Auto-applied | ✅ Fixed | Get pending badge approvals |
| GET | `/api/current-stars` | ✅ Auto-applied | ✅ Fixed | Get current star count |
| POST | `/api/approve-badge` | ✅ Auto-applied | ✅ Fixed | Approve badge |
| POST | `/api/reject-badge` | ✅ Auto-applied | ✅ Fixed | Reject badge |
| GET | `/api/badge-summary` | ✅ Auto-applied | ✅ Fixed | Get badge summary |
| GET | `/api/badge-history` | ✅ Auto-applied | ✅ Fixed | Get badge history |

### Honor Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/honors` | ✅ Auto-applied | ✅ Fixed | Get honors |
| GET | `/api/recent-honors` | ✅ Auto-applied | ✅ Fixed | Get recent honors |
| POST | `/api/award-honor` | ✅ Auto-applied | ✅ Fixed | Award honor to participant |
| GET | `/api/honors-report` | ✅ Auto-applied | ✅ Fixed | Get honors report |
| GET | `/api/available-dates` | ✅ Auto-applied | ✅ Fixed | Get available honor dates |

### Attendance Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/attendance` | ✅ Auto-applied | ✅ Fixed | Get attendance records |
| POST | `/api/update-attendance` | ✅ Auto-applied | ✅ Fixed | Update attendance status |
| GET | `/api/attendance-dates` | ✅ Auto-applied | ✅ Fixed | Get attendance dates |
| GET | `/api/attendance-report` | ✅ Auto-applied | ✅ Fixed | Get attendance report |
| POST | `/api/save-guest` | ✅ Auto-applied | ✅ Fixed | Save guest attendance |
| GET | `/api/guests-by-date` | ✅ Auto-applied | ✅ Fixed | Get guests by date |

### Calendar Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/calendars` | ✅ Auto-applied | ✅ Fixed | Get calendar data |
| POST | `/api/update-calendar` | ✅ Auto-applied | ✅ Fixed | Update calendar amount |
| POST | `/api/update-calendar-paid` | ✅ Auto-applied | ✅ Fixed | Update calendar paid status |
| POST | `/api/update-calendar-amount-paid` | ✅ Auto-applied | ✅ Fixed | Update calendar amount paid |
| GET | `/api/participant-calendar` | ✅ Auto-applied | ✅ Fixed | Get participant calendar |

### Reunion Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/reunion-preparation` | ✅ Auto-applied | ✅ Fixed | Get reunion preparation data |
| POST | `/api/save-reunion-preparation` | ✅ Auto-applied | ✅ Fixed | Save reunion preparation |
| GET | `/api/reunion-dates` | ✅ Auto-applied | ✅ Fixed | Get reunion dates |
| GET | `/api/activites-rencontre` | ✅ Auto-applied | ✅ Fixed | Get meeting activities |
| POST | `/api/save-reminder` | ✅ Auto-applied | ✅ Fixed | Save reminder |
| GET | `/api/reminder` | ✅ Auto-applied | ✅ Fixed | Get reminder |
| GET | `/api/next-meeting-info` | ✅ Auto-applied | ✅ Fixed | Get next meeting info |
| GET | `/api/animateurs` | ✅ Auto-applied | ✅ Fixed | Get animators |

### Report Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/health-contact-report` | ✅ Auto-applied | ✅ Fixed | Get health contact report |
| GET | `/api/health-report` | ✅ Auto-applied | ✅ Fixed | Get health report |
| GET | `/api/allergies-report` | ✅ Auto-applied | ✅ Fixed | Get allergies report |
| GET | `/api/medication-report` | ✅ Auto-applied | ✅ Fixed | Get medication report |
| GET | `/api/vaccine-report` | ✅ Auto-applied | ✅ Fixed | Get vaccine report |
| GET | `/api/leave-alone-report` | ✅ Auto-applied | ✅ Fixed | Get leave alone report |
| GET | `/api/media-authorization-report` | ✅ Auto-applied | ✅ Fixed | Get media authorization report |
| GET | `/api/missing-documents-report` | ✅ Auto-applied | ✅ Fixed | Get missing documents report |
| GET | `/api/mailing-list` | ✅ Auto-applied | ✅ Fixed | Get mailing list |

### Organization Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/get-organization-id` | ✅ Auto-applied | ✅ Fixed | Get organization ID |
| POST | `/api/create-organization` | ✅ Auto-applied | ✅ Fixed | Create new organization |
| POST | `/api/switch-organization` | ✅ Auto-applied | ✅ Fixed | Switch organization context |
| GET | `/api/organization-settings` | ✅ Auto-applied | ✅ Fixed | Get organization settings |
| GET | `/api/news` | ✅ Auto-applied | ✅ Fixed | Get organization news |

### Utility Routes (`/api/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/api/test-connection` | ✅ Auto-applied | ✅ Fixed | Test database connection |
| GET | `/api/initial-data` | ✅ Auto-applied | ✅ Fixed | Get initial application data |
| GET | `/api/subscribers` | ✅ Auto-applied | ✅ Fixed | Get subscribers |

### Public Routes (`/public/*`) - ✅ CONSISTENT
| Method | Route | Organization Required | Status | Description |
|--------|-------|---------------------|---------|-------------|
| GET | `/public/get_organization_id` | ✅ Via hostname lookup | ✅ Fixed | Get organization ID from hostname |
| GET | `/public/organization-settings` | ✅ Auto-applied | ✅ Fixed | Get public organization settings |
| GET | `/public/get_news` | ✅ Via hostname lookup | ✅ Fixed | Get public news |
| POST | `/public/login` | ✅ Auto-applied | ✅ Fixed | Public login endpoint |
| POST | `/public/register` | ✅ Via JWT token | ✅ Fixed | Public registration |
| GET | `/public/initial-data` | ❌ Not required | ✅ Correct | Initial frontend data |
| POST | `/public/verify-email` | ❌ Not required | ✅ Correct | Email verification |
| POST | `/public/request_reset` | ❌ Not required | ✅ Correct | Password reset request |
| POST | `/public/reset_password` | ❌ Not required | ✅ Correct | Password reset |
| POST | `/public/authenticate` | ❌ Not required | ✅ Correct | API key authentication |

---

## ✅ Implementation Summary

### Changes Applied:

1. **Global Middleware Applied** - `index.js:142-154` ensures all `/api` routes have organization context
2. **Standardized Controllers** - All controllers use `getOrganizationId(req)` from `utils/organizationContext.js:14`
3. **Deprecated Redundant Middleware** - `middleware/organizationContext.js:10` neutralized
4. **Updated Public Routes** - `routes/public.js:8,75,173` use standardized approach
5. **Fixed Organization Controller** - `organizationController.js:10` simplified

### Testing Results:
- ✅ Server starts successfully on port 3001
- ✅ Database connections established
- ✅ No `requireOrganization()` middleware calls found in codebase
- ✅ All controllers use consistent organization retrieval pattern

### Architecture Benefits:
- **Consistent**: All API routes have uniform organization handling
- **Efficient**: Single organization validation per request
- **Maintainable**: Centralized organization logic
- **Scalable**: Easy to modify organization handling across entire API

## 🎯 Status: All Recommendations Successfully Implemented

The API now has **100% consistent organization-id handling** across all endpoints. No further optimizations needed.