/*----------------------------------------------------------------------------
 *  port_fast.h — fast-memory placement macros. ds-lba's DS build put hot
 *  functions and data in the DS's tightly coupled memory through these; on
 *  every other build, this one included, they're empty.
 *
 *  NOTE for engine files: include this header with a relative path
 *  ("../../translate/port_fast.h") — it has no dependencies.
 *---------------------------------------------------------------------------*/
#ifndef PORT_FAST_H
#define PORT_FAST_H

#define PORT_FASTCODE
#define PORT_FASTDATA
#define PORT_FASTBSS

#endif /* PORT_FAST_H */
