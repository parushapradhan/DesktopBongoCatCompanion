# Bongo Buddy shell integration
#
# Pings the local webhook whenever a command in THIS terminal exits with a
# non-zero status, so the "error" reaction is driven by what's actually
# happening in your terminal -- not a manual test button. Works with any
# terminal app, since it hooks your shell (zsh/bash), not a specific window.
#
# Setup: source this file from your shell rc, then open a new terminal tab.
#   zsh:  echo 'source "'"$(pwd)"'/shell-integration.sh"' >> ~/.zshrc
#   bash: echo 'source "'"$(pwd)"'/shell-integration.sh"' >> ~/.bashrc
# (run that from inside desktop-app/, or just paste the full path by hand)
#
# Safe to leave in your rc file even when Bongo Buddy isn't running -- the
# webhook call just fails silently and your terminal works as normal.

_bongo_buddy_notify_error() {
  local exit_code=$?
  [ "$exit_code" -eq 0 ] && return
  [ "$exit_code" -eq 130 ] && return  # Ctrl-C isn't really "an error"

  local last_cmd
  last_cmd=$(fc -ln -1 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/"/\\"/g')

  curl -s -m 1 -X POST http://127.0.0.1:4756/notify \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"error\",\"message\":\"Command failed (exit ${exit_code}): ${last_cmd}\"}" \
    >/dev/null 2>&1 &
  disown 2>/dev/null
}

if [ -n "$ZSH_VERSION" ]; then
  autoload -Uz add-zsh-hook 2>/dev/null
  if ! add-zsh-hook precmd _bongo_buddy_notify_error 2>/dev/null; then
    precmd_functions+=(_bongo_buddy_notify_error)
  fi
elif [ -n "$BASH_VERSION" ]; then
  PROMPT_COMMAND="_bongo_buddy_notify_error${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
