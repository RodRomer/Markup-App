/**
 * Everything account-specific or tunable about the overage check.
 *
 * Field and stage ids were read from the live Keap account's opportunity model
 * (GET /opportunities/model, /opportunity/stage_pipeline) on 2026-09-14, for the
 * prototype in VS Development\Overage, and copied from its settings.py.
 */

export const STAGE_CAD_LIVE = 61; // "CAD Live"

export const FIELD_OVERAGE = 520; // Building SF - Overage (whole number)
export const FIELD_NOTES = 226; // CAD/Plot Notes (text area)
export const FIELD_PM_EMAIL = 311; // Project Manager email
export const FIELD_DRAFTER = 680; // Drafter Name (list box; comma-separated when several)
export const FIELD_SF_EST = 208; // Building SF (Scope Area) - Est -- context in the email only

export const MISSING_SF_BUSINESS_DAYS = 3;
export const OVERAGE_MULTIPLIER = 1.1;
