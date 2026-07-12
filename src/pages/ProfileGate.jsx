import { useState } from 'react'

export function ProfileGate({ profiles, loading, error, onSelect, onCreate }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)

  async function handleCreate(event) {
    event.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      await onCreate(name)
      setName('')
    } catch (err) {
      setFormError(err.message || 'Could not create profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page profile-gate">
      <section className="hero-panel profile-panel">
        <p className="eyebrow">Shared progress</p>
        <h1>Who’s learning?</h1>
        <p className="hero-copy">
          Pick your name so lesson and flashcard progress sync across devices.
        </p>

        {loading ? <p className="profile-status">Loading profiles…</p> : null}
        {error ? <p className="profile-error">{error}</p> : null}

        {!loading && profiles.length > 0 ? (
          <div className="profile-list" role="list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className="profile-chip"
                onClick={() => onSelect(profile.id)}
              >
                {profile.name}
              </button>
            ))}
          </div>
        ) : null}

        <form className="profile-form" onSubmit={handleCreate}>
          <label className="profile-label" htmlFor="profile-name">
            {profiles.length ? 'Add someone' : 'Create your profile'}
          </label>
          <div className="profile-form-row">
            <input
              id="profile-name"
              className="profile-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              autoComplete="nickname"
              maxLength={40}
              required
            />
            <button type="submit" className="primary-button" disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
          {formError ? <p className="profile-error">{formError}</p> : null}
        </form>
      </section>
    </div>
  )
}
