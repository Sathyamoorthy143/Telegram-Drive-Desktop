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
