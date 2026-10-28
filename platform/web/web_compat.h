/*
 * web_compat.h — force-included in front of every ENGINE translation unit in
 * the Emscripten build (after platform/sdl/watcom_compat.h).
 *
 * Fills the gaps that MinGW covered for the PC build, the same way
 * platform/nds/watcom_compat.h does for newlib:
 *   - stricmp/strcmpi/strnicmp  -> strcasecmp/strncasecmp
 *   - index                     -> renamed (GIF.C/PCX.C use it as a variable)
 *   - _MAX_PATH/_MAX_DRIVE/...  -> MinGW values
 *   - fopen/remove              -> WEB_fopen/WEB_remove (lowercase, '\'->'/')
 *   - main                      -> lba_main (C_EXTERN.H still prototypes main
 *                                  with UBYTE**, which clang rejects)
 */
#ifndef WEB_COMPAT_H
#define WEB_COMPAT_H

#include <stddef.h>
extern int strcasecmp(const char *, const char *);
extern int strncasecmp(const char *, const char *, size_t);

#include <string.h>
#define index lba1_index

#define stricmp(a, b) strcasecmp((const char *)(a), (const char *)(b))
#define strcmpi(a, b) strcasecmp((const char *)(a), (const char *)(b))
#define strnicmp(a, b, n) strncasecmp((const char *)(a), (const char *)(b), (n))

#ifndef _MAX_PATH
#define _MAX_PATH 260
#define _MAX_DRIVE 3
#define _MAX_DIR 256
#define _MAX_FNAME 256
#define _MAX_EXT 256
/* Called without a prototype somewhere (gnu89 implicit `int f()`) but
 * defined `void`. Harmless on x86/ARM, but wasm call signatures must match
 * exactly or wasm-ld turns the call into a trap. Declare them void
 * (non-prototype, so argument types stay as the callers pass them). */
void AsmTexturedTriangleNoClip();
void Balance();
void BlackFrame();
void ClearCDR();
void ClearSystem();
void ClearTimer();
void ClearVoiceFile();
void CopyBlockMCGA();
void CopyFrame();
void DecompColonne();
void DoFire();
void DrawFrame();
void Expand();
void FillTextPolyNoClip();
void FillVertic();
void InitMcgaMode();
void InitSystem();
void InitTimer();
void InitVoiceFile();
void Line();
void Map2Screen();
void Mcga_Cls();
void Mcga_Flip();
void MixteColonne();
void Read_Gif();
void Rotate();
void SetAngleCamera();
void SetFillDetails();
void SetFollowCamera();
void SetInverseAngleCamera();
void SetPosCamera();
void ShadeBox();
void SimpleInitSvga();
void SmallSort();
void SpeakFromCD();
void StopSpeak();
void Touch();
void UpdateFrame();
void _splitpath();
void _makepath();

#endif

#include <stdio.h>
FILE *WEB_fopen(const char *name, const char *mode);
int WEB_remove(const char *name);
#define fopen WEB_fopen
#define remove WEB_remove

#define main lba_main

char *itoa(int value, char *buf, int radix);
char *ltoa(long value, char *buf, int radix);
char *ultoa(unsigned long value, char *buf, int radix);

/* called before their definition in the same file: gnu89 implicit int would
 * conflict with the void definition (an error in clang) */
void PORT_Diag(const char *fmt, ...);
void PORT_DebugHook(void);
int PORT_DebugAutoStart(void);
int PORT_DebugLogo(void);
int PORT_Feature(const char *name);
int PORT_HeroFile3D(int scene);
int PORT_JumpPending(void);
void StopMusicCD(void);
void PlayAllMusic(short num);
void PlayCdTrack(short num);
void AddFileNameOnHD(char *filename, unsigned long size, unsigned long timer);
void SaveGameWithName(char *fileName, short isAutoSave);

/* Called without a prototype somewhere (gnu89 implicit `int f()`) but
 * defined `void`. Harmless on x86/ARM, but wasm call signatures must match
 * exactly or wasm-ld turns the call into a trap. Declare them void
 * (non-prototype, so argument types stay as the callers pass them). */
void AsmTexturedTriangleNoClip();
void Balance();
void BlackFrame();
void ClearCDR();
void ClearSystem();
void ClearTimer();
void ClearVoiceFile();
void CopyBlockMCGA();
void CopyFrame();
void DecompColonne();
void DoFire();
void DrawFrame();
void Expand();
void FillTextPolyNoClip();
void FillVertic();
void InitMcgaMode();
void InitSystem();
void InitTimer();
void InitVoiceFile();
void Line();
void Map2Screen();
void Mcga_Cls();
void Mcga_Flip();
void MixteColonne();
void Read_Gif();
void Rotate();
void SetAngleCamera();
void SetFillDetails();
void SetFollowCamera();
void SetInverseAngleCamera();
void SetPosCamera();
void ShadeBox();
void SimpleInitSvga();
void SmallSort();
void SpeakFromCD();
void StopSpeak();
void Touch();
void UpdateFrame();
void _splitpath();
void _makepath();

#endif
