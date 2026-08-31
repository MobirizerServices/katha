"""Katha admin-api — back-office API (RBAC + immutable audit).

Deployed as `app.main:app` (see the `app/` shim); the implementation lives in
this `admin_app` package so it never collides with core-api's top-level `app`
package when both services share a PYTHONPATH (e.g. the combined test run).
"""
