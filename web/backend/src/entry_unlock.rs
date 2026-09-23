#[derive(Debug, PartialEq)]
pub enum EntryUnlockError {
    MissingHash,
    WrongPassword,
    Inactive,
    NotOwner,
}

pub fn evaluate_master_unlock(
    stored: Option<&str>,
    password: &str,
    telegram_id: &str,
) -> Result<(), EntryUnlockError> {
    let Some(hash) = stored.filter(|h| !h.is_empty()) else {
        return Err(EntryUnlockError::MissingHash);
    };
    if crate::supabase::verify_master_password(password, telegram_id, hash) {
        Ok(())
    } else {
        Err(EntryUnlockError::WrongPassword)
    }
}

pub fn evaluate_org_unlock(
    stored: Option<&str>,
    password: &str,
    org_id: &str,
    active: bool,
    owner_id: Option<&str>,
    telegram_id: &str,
) -> Result<(), EntryUnlockError> {
    if owner_id != Some(telegram_id) {
        return Err(EntryUnlockError::NotOwner);
    }
    if !active {
        return Err(EntryUnlockError::Inactive);
    }
    let Some(hash) = stored.filter(|h| !h.is_empty()) else {
        return Err(EntryUnlockError::MissingHash);
    };
    if crate::supabase_org::verify_org_entry_password(password, org_id, hash) {
        Ok(())
    } else {
        Err(EntryUnlockError::WrongPassword)
    }
}

/// Owner recorded on the org row, normalized: NULL, missing, empty, or
/// whitespace-only all mean "unclaimed" (legacy rows, uuid-migration retry
/// path). Callers must treat an unclaimed org as claimable, never as
/// foreign-owned — otherwise a legitimate master sees `NotOwner` (surfaced
/// as a generic invalid login) forever.
pub fn effective_owner_id(org_owner: Option<&str>) -> Option<&str> {
    org_owner.filter(|o| !o.trim().is_empty())
}

/// Owner actually checked for an org unlock attempt. Unclaimed orgs
/// (see [`effective_owner_id`]) are evaluated as if owned by the
/// attempting Telegram user; the caller should best-effort claim the row
/// first. Foreign owners stay denied (`NotOwner` downstream).
pub fn unlock_owner_for_check<'a>(
    org_owner: Option<&'a str>,
    telegram_uid: &'a str,
) -> Option<&'a str> {
    Some(effective_owner_id(org_owner).unwrap_or(telegram_uid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_unlock_accepts_match_and_rejects_wrong_or_missing() {
        let hash = crate::supabase::hash_master_password("secret", "123");
        assert!(evaluate_master_unlock(Some(&hash), "secret", "123").is_ok());
        assert_eq!(
            evaluate_master_unlock(Some(&hash), "wrong", "123"),
            Err(EntryUnlockError::WrongPassword)
        );
        assert_eq!(
            evaluate_master_unlock(None, "secret", "123"),
            Err(EntryUnlockError::MissingHash)
        );
        assert_eq!(
            evaluate_master_unlock(Some(""), "secret", "123"),
            Err(EntryUnlockError::MissingHash)
        );
    }

    #[test]
    fn unlock_owner_for_check_claims_unclaimed_and_keeps_others() {
        assert_eq!(unlock_owner_for_check(None, "99"), Some("99"));
        assert_eq!(unlock_owner_for_check(Some(""), "99"), Some("99"));
        assert_eq!(unlock_owner_for_check(Some("   "), "99"), Some("99"));
        assert_eq!(unlock_owner_for_check(Some("99"), "99"), Some("99"));
        assert_eq!(unlock_owner_for_check(Some("1"), "99"), Some("1"));
    }

    #[test]
    fn unlock_trims_password_like_create_and_reset() {
        // Create/reset hash the trimmed password; unlock must verify the
        // same way or a trailing space (mobile keyboards) permanently fails.
        let stored = crate::supabase_org::hash_org_entry_password("secret", "org-1");
        assert!(evaluate_org_unlock(
            Some(&stored),
            "secret",
            "org-1",
            true,
            Some("99"),
            "99"
        )
        .is_ok());
        // Raw-vs-trimmed parity is enforced at the call site; the pure
        // evaluator stays exact-match by contract.
        assert_eq!(
            evaluate_org_unlock(Some(&stored), "secret ", "org-1", true, Some("99"), "99"),
            Err(EntryUnlockError::WrongPassword)
        );
    }

    #[test]
    fn unclaimed_org_unlocks_with_correct_password_for_attempter() {
        // The broken-org scenario: no owner row, attempter knows the entry
        // password → must verify (was NotOwner before the claim fallback).
        let hash = crate::supabase_org::hash_org_entry_password("secret", "org-1");
        let owner = unlock_owner_for_check(None, "99");
        assert!(evaluate_org_unlock(Some(&hash), "secret", "org-1", true, owner, "99").is_ok());
        assert_eq!(
            evaluate_org_unlock(Some(&hash), "wrong", "org-1", true, owner, "99"),
            Err(EntryUnlockError::WrongPassword)
        );
        // Foreign owners still denied even with the right password.
        let foreign = unlock_owner_for_check(Some("1"), "99");
        assert_eq!(
            evaluate_org_unlock(Some(&hash), "secret", "org-1", true, foreign, "99"),
            Err(EntryUnlockError::NotOwner)
        );
    }

    #[test]
    fn org_unlock_rejects_not_owner_inactive_missing_and_wrong() {
        let hash = crate::supabase_org::hash_org_entry_password("secret", "org-1");
        assert!(evaluate_org_unlock(Some(&hash), "secret", "org-1", true, Some("99"), "99").is_ok());
        assert_eq!(
            evaluate_org_unlock(Some(&hash), "secret", "org-1", true, Some("1"), "99"),
            Err(EntryUnlockError::NotOwner)
        );
        assert_eq!(
            evaluate_org_unlock(Some(&hash), "secret", "org-1", false, Some("99"), "99"),
            Err(EntryUnlockError::Inactive)
        );
        assert_eq!(
            evaluate_org_unlock(None, "secret", "org-1", true, Some("99"), "99"),
            Err(EntryUnlockError::MissingHash)
        );
        assert_eq!(
            evaluate_org_unlock(Some(&hash), "wrong", "org-1", true, Some("99"), "99"),
            Err(EntryUnlockError::WrongPassword)
        );
    }
}
