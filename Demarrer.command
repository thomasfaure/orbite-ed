#!/bin/zsh
cd "${0:A:h}"
# Sélectionne la version de .nvmrc si nvm est installé (Homebrew ou installation standard).
for nvm_script in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /opt/homebrew/opt/nvm/nvm.sh; do
  if [[ -s "$nvm_script" ]]; then
    source "$nvm_script" && nvm use >/dev/null
    break
  fi
done
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(+process.versions.node.split(".")[0] < 24 ? 1 : 0)'; then
  print 'Node.js 24 ou supérieur est requis. Installez-le depuis https://nodejs.org.'
  read '?Appuyez sur Entrée pour fermer.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Installation des outils de compilation…'
  npm install || { read '?Installation impossible. Appuyez sur Entrée pour fermer.'; exit 1; }
fi
print 'Ouvrez http://127.0.0.1:3210 dans votre navigateur.'
npm start
