#!/bin/sh
# перед каждым коммитом меню: обновить метку версии, чтобы браузеры сразу взяли новую страницу
sed -i "s/<meta name=\"kwver\" content=\"[0-9]*\">/<meta name=\"kwver\" content=\"$(date +%Y%m%d%H%M)\">/" "$(dirname "$0")/../../menu/index.html"
