fx_version "cerulean"
game "gta5"
lua54 "yes"

name "cbz_crosshair"
author "wthejulio · CBz Network"
description "Per-player crosshair selector — presets, editor, share codes; keeps your server's own reticle as the default"
version "1.0.0"

client_scripts {
    "config.lua",
    "locales/*.lua",
    "shared/locale.lua",
    "client/state.lua",
    "client/main.lua",
}

ui_page "web/index.html"

files {
    "web/index.html",
    "web/style.css",
    "web/crosshair.js",
    "web/app.js",
    "web/fonts/*.woff2",
    "web/custom/*.png",
    "web/sounds/*.ogg",
}

escrow_ignore {
    "config.lua",
    "locales/*.lua",
}
