# LBA1 — browser build (Emscripten, wasm32: same ILP32 model as the DS/PC builds)
#
#   make           -> build/index.html (+ .js, .wasm): the engine, no game data
#   make serve     -> http://localhost:8080/
#
# The page asks for the player's own copy of the game (a zip, the folder, or
# GOG's Mac app, dropped or chosen; shell.html, loader.js) and keeps it in
# the browser (IndexedDB, mounted on /lba), with the saves. Nothing of the
# game is in this repository or on the server.
#
# index.html?dev=1 shows the developer panel: scene jumps (web_debug.c);
# ?scene=N[&chapter=C][&items=all] starts a new game in scene N.
# scenes.json: scene names from github.com/LBALab/metadata (LBA1/HQR/SCENE.HQR.json).
#
# Reuses the engine, translate/ and the platform/sdl shim; the web-specific
# pieces are web_hooks.{h,c} (yielding accessors), web_sys.c, web_music.c,
# web_debug.c and the __EMSCRIPTEN__ paths in sdl_video.c.

TOP       := ../..
ENGINE    := $(TOP)/engine
SDLDIR    := ../sdl
TRANSLATE := $(TOP)/translate
OBJDIR    := build/obj
OUT       := build/index.html

CC     := emcc
CFLAGS := -O2 -g2 -fsigned-char -fcommon -Wall -Wno-unused -Wno-parentheses \
          -DCDROM -DPORT_SDL -sUSE_SDL=2 \
          -I$(ENGINE) -I$(ENGINE)/game -I$(SDLDIR)

ENGINE_CFLAGS := $(CFLAGS) -std=gnu89 -include $(SDLDIR)/watcom_compat.h -include web_compat.h -include web_hooks.h \
          -Wno-implicit-function-declaration -Wno-implicit-int \
          -Wno-int-conversion -Wno-incompatible-pointer-types \
          -Wno-pointer-sign -Wno-incompatible-pointer-types-discards-qualifiers \
          -Wno-format -Wno-return-type -Wno-error \
          -I$(ENGINE)/LIB_SYS -I$(ENGINE)/LIB_CD -I$(ENGINE)/LIB_MENU \
          -I$(ENGINE)/LIB_SVGA -I$(SDLDIR)/compat/inc -Icompat -I.

LDFLAGS := --profiling-funcs -sUSE_SDL=2 -sASYNCIFY -sASYNCIFY_STACK_SIZE=65536 \
          -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=64MB -sSTACK_SIZE=1MB \
          -sEXIT_RUNTIME=0 -sFORCE_FILESYSTEM=1 -lidbfs.js \
          -sEXPORTED_RUNTIME_METHODS=FS,addRunDependency,removeRunDependency \
          --shell-file shell.html

ENGINE_SRC := $(wildcard $(ENGINE)/game/*.C $(ENGINE)/LIB_3D/*.C $(ENGINE)/LIB_CD/*.C \
              $(ENGINE)/LIB_MENU/*.C $(ENGINE)/LIB_MIDI/*.C $(ENGINE)/LIB_MIX/*.C \
              $(ENGINE)/LIB_SVGA/*.C $(ENGINE)/LIB_SYS/*.C)
PLAT_SRC   := $(wildcard $(SDLDIR)/*.c)
WEB_SRC    := web_hooks.c web_sys.c web_debug.c web_music.c
TRANS_SRC  := $(wildcard $(TRANSLATE)/*.c)

OBJS := $(patsubst $(ENGINE)/%.C,$(OBJDIR)/engine/%.o,$(ENGINE_SRC)) \
        $(patsubst $(SDLDIR)/%.c,$(OBJDIR)/sdl/%.o,$(PLAT_SRC)) \
        $(patsubst %.c,$(OBJDIR)/web/%.o,$(WEB_SRC)) \
        $(patsubst $(TRANSLATE)/%.c,$(OBJDIR)/translate/%.o,$(TRANS_SRC))

all: $(OUT)

MODKIT := $(wildcard ../../modkit/src/*.ts)

$(OUT): $(OBJS) shell.html loader.js mods.js scenes.json vendor/fflate.js $(MODKIT)
	$(CC) -o $@ $(OBJS) $(LDFLAGS)
	cp loader.js mods.js scenes.json build/
	@mkdir -p build/vendor && cp vendor/*.js build/vendor/
	node ../../modkit/strip.mjs build/modkit   # the mod builder, as plain JS (Node 22.13+)

$(OBJDIR)/engine/%.o: $(ENGINE)/%.C web_hooks.h web_compat.h
	@mkdir -p $(dir $@)
	$(CC) $(ENGINE_CFLAGS) -x c -c $< -o $@

$(OBJDIR)/sdl/%.o: $(SDLDIR)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

# web_debug.c reads/writes engine globals: build it like an engine file
$(OBJDIR)/web/web_debug.o: web_debug.c web_compat.h web_hooks.h
	@mkdir -p $(dir $@)
	$(CC) $(ENGINE_CFLAGS) -c $< -o $@

$(OBJDIR)/web/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

$(OBJDIR)/translate/%.o: $(TRANSLATE)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

serve:
	python3 serve.py 8080

clean:
	rm -rf build

.PHONY: all serve clean
