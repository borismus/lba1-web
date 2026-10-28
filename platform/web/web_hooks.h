/*
 * web_hooks.h — force-included into engine sources for the Emscripten build.
 *
 * The engine busy-waits on Key/Joy/Fire/TimerRef (e.g. `while (Key);`),
 * expecting interrupts (DOS) or a video thread (PC build) to update them.
 * The browser has neither, so every access goes through an accessor that
 * calls PORT_Yield(): it advances the timer, pumps SDL events, presents a
 * frame and yields to the browser via Asyncify.
 *
 * The engine headers' `extern volatile UWORD Key;` expands to a matching
 * function prototype, so no engine header needs editing.
 */
#ifndef WEB_HOOKS_H
#define WEB_HOOKS_H

volatile unsigned short *PORT_PollKey(void);
volatile unsigned short *PORT_PollFuncKey(void);
volatile unsigned short *PORT_PollJoy(void);
volatile unsigned short *PORT_PollFire(void);
volatile long *PORT_PollClick(void);
volatile unsigned long *PORT_PollTimerRef(void);
volatile unsigned long *PORT_PollTimerSystem(void);

#define Key (*PORT_PollKey())
#define FuncKey (*PORT_PollFuncKey())
#define Joy (*PORT_PollJoy())
#define Fire (*PORT_PollFire())
#define Click (*PORT_PollClick())
#define TimerRef (*PORT_PollTimerRef())
#define TimerSystem (*PORT_PollTimerSystem())

#endif
