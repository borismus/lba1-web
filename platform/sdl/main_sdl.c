/*
 * main_sdl.c — SDL2 entry point.
 *
 * The game's original entry point is void main(int, UBYTE*[]) in
 * engine/game/PERSO.C; it was renamed lba_main (logged edit) because
 * SDL2main owns main()/WinMain() on MinGW.
 */
#include <SDL.h>
#include <stdio.h>
#include "port.h"
#ifdef __EMSCRIPTEN__
#include <unistd.h>
#endif

void lba_main(int argc, UBYTE *argv[]);

int main(int argc, char *argv[])
{
	setvbuf(stdout, NULL, _IONBF, 0); /* engine printf()s are our trace */
	setvbuf(stderr, NULL, _IONBF, 0);

#ifdef __EMSCRIPTEN__
	/* keys go to the game only while the canvas has focus (the page has a
	 * scene panel with text inputs) */
	SDL_SetHint(SDL_HINT_EMSCRIPTEN_KEYBOARD_ELEMENT, "#canvas");
#endif
	if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) != 0)
	{
		fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
		return 1;
	}

#ifdef __EMSCRIPTEN__
	chdir("/lba"); /* the player's game files (platform/web/loader.js) */
	{
		void PORT_DebugInitFromURL(void); /* platform/web/web_debug.c */
		PORT_DebugInitFromURL();
	}
#endif

	lba_main(argc, (UBYTE **)argv);

	SDL_Quit();
	return 0;
}
