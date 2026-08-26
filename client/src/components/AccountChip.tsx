import { useI18n } from '../i18n'
import { useAuth } from '../auth'

/**
 * Sidebar footer: greets the signed-in user with their name and picture.
 *
 * Auth only exists at the App Service edge, so there is no session when the app
 * runs on a dev machine. This owns the `.foot` wrapper rather than letting the
 * layout render it, so a signed-out session produces no element at all instead
 * of an empty bordered strip at the bottom of the sidebar.
 */
export default function AccountChip() {
  const { t } = useI18n()
  const { status, user } = useAuth()

  if (status !== 'signed-in') return null

  const firstName = user.name.split(/\s+/)[0] || user.name

  return (
    <div className="foot">
      <div className="account" title={user.email || user.name}>
        {user.photoUrl ? (
          <img className="avatar" src={user.photoUrl} alt={user.name} />
        ) : (
          <span className="avatar avatar-initials" aria-hidden="true">
            {user.initials}
          </span>
        )}

        <span className="account-text">
          <span className="account-welcome">{t('account.welcome', { name: firstName })}</span>
          {user.email && <span className="account-email">{user.email}</span>}
        </span>
      </div>
    </div>
  )
}
