// Options page: edit and save the two URLs, and check that the backend answers.
import { DEFAULTS, getSettings, normalizeUrl, saveSettings } from './settings.js'

const form = document.getElementById('form')
const status = document.getElementById('status')
const fields = ['backendUrl', 'siteUrl']

const say = (text, isError = false) => {
  status.textContent = text
  status.className = isError ? 'error' : ''
}

getSettings().then((settings) => {
  for (const name of fields) document.getElementById(name).value = settings[name]
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const changes = {}
    for (const name of fields) changes[name] = normalizeUrl(document.getElementById(name).value || DEFAULTS[name])
    await saveSettings(changes)
    for (const name of fields) document.getElementById(name).value = changes[name]
    say('Saved.')
  } catch (error) {
    say(error.message, true)
  }
})

document.getElementById('test').addEventListener('click', async () => {
  say('Checking…')
  try {
    const backendUrl = normalizeUrl(document.getElementById('backendUrl').value)
    const response = await fetch(`${backendUrl}/api/v1/health`)
    const body = await response.json()
    say(response.ok ? `Backend is up (VoxShield ${body.version ?? ''}).` : `Backend answered HTTP ${response.status}.`, !response.ok)
  } catch {
    say('Could not reach the backend. Check the address and that the server is running.', true)
  }
})
