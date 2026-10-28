#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>

#include "ADELINE.H"
#include "LIB_SYS.H"

char ItoaTempoString[40]; /* c'est 17 le max je crois */

char *Itoa(LONG value)
{
	return itoa(value, ItoaTempoString, 10);
}
