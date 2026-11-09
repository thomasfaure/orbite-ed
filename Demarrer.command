#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 22 ou supérieur est requis. Installez-le depuis https://nodejs.org.'
  read '?Appuyez sur Entrée pour fermer.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print 'Installation des outils de compilation…'
  npm install || { read '?Installation impossible. Appuyez sur Entrée pour fermer.'; exit 1; }
fi
print 'Ouvrez http://127.0.0.1:3210 dans votre navigateur.'
npm start
