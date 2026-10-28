/*
 * web_hooks.c — accessors behind web_hooks.h. Compiled without that header,
 * so the names below are the real variables defined in the SDL shim.
 */
#include "port.h"

void PORT_Yield(void); /* sdl_video.c */

volatile UWORD *PORT_PollKey(void) { PORT_Yield(); return &Key; }
volatile UWORD *PORT_PollFuncKey(void) { PORT_Yield(); return &FuncKey; }
volatile UWORD *PORT_PollJoy(void) { PORT_Yield(); return &Joy; }
volatile UWORD *PORT_PollFire(void) { PORT_Yield(); return &Fire; }
volatile LONG *PORT_PollClick(void) { PORT_Yield(); return &Click; }
volatile ULONG *PORT_PollTimerRef(void) { PORT_Yield(); return &TimerRef; }
volatile ULONG *PORT_PollTimerSystem(void) { PORT_Yield(); return &TimerSystem; }
