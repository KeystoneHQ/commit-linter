curl -o .git/hooks/commit-msg https://raw.githubusercontent.com/KeystoneHQ/commit-linter/master/commit-msg
chmod u+rx .git/hooks/commit-msg 
curl -o .git/hooks/commit-msg-linter.js https://raw.githubusercontent.com/KeystoneHQ/commit-linter/master/commit-msg-linter.js