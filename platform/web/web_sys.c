/*
 * web_sys.c — Emscripten replacements for the MinGW/msvcrt pieces the SDL
 * shim and the engine rely on: path helpers, a case-normalizing fopen,
 * dirent-based SYS_Find*, Touch. Adapted from platform/nds/nds_sys.c.
 *
 * Game data is preloaded into /lba with lowercase names (see Makefile);
 * the engine opens files as "RESS.HQR", "vox\\EN_000.VOX", ".\\lba.cfg"...
 */
#include <ctype.h>
#include <stdarg.h>
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <utime.h>
#include "port.h"
#include "../../engine/LIB_SYS/SYS_FILESYSTEM.H"

/* lowercase, '\' -> '/', strip a leading "./" */
static void NormPath(const char *s, char *buf, size_t size)
{
	size_t i = 0;

	if (s[0] == '.' && (s[1] == '\\' || s[1] == '/'))
		s += 2;
	while (*s && i < size - 1)
	{
		char c = *s++;

		buf[i++] = (c == '\\') ? '/' : (char)tolower((unsigned char)c);
	}
	buf[i] = 0;
}

FILE *WEB_fopen(const char *name, const char *mode)
{
	char buf[280];

	if (!name)
		return NULL;
	NormPath(name, buf, sizeof(buf));
	return fopen(buf, mode);
}

int WEB_remove(const char *name)
{
	char buf[280];

	NormPath(name, buf, sizeof(buf));
	return remove(buf);
}

void Touch(UBYTE *filename)
{
	char buf[280];

	NormPath((const char *)filename, buf, sizeof(buf));
	utime(buf, NULL);
}

/* MinGW _splitpath/_makepath used by FILES.C AddExt and DISKFUNC.C */
void _splitpath(const char *path, char *drive, char *dir,
				char *fname, char *ext)
{
	const char *p, *slash, *dot, *body;

	if (drive)
		drive[0] = 0;
	if (dir)
		dir[0] = 0;
	if (fname)
		fname[0] = 0;
	if (ext)
		ext[0] = 0;
	if (!path)
		return;

	p = path;
	if (isalpha((unsigned char)p[0]) && p[1] == ':')
	{
		if (drive)
		{
			drive[0] = p[0];
			drive[1] = ':';
			drive[2] = 0;
		}
		p += 2;
	}

	slash = NULL;
	for (body = p; *body; body++)
		if (*body == '/' || *body == '\\')
			slash = body;

	if (slash)
	{
		if (dir)
		{
			size_t n = (size_t)(slash - p) + 1;

			if (n > 255)
				n = 255;
			memcpy(dir, p, n);
			dir[n] = 0;
		}
		p = slash + 1;
	}

	dot = NULL;
	for (body = p; *body; body++)
		if (*body == '.')
			dot = body;

	if (dot)
	{
		if (fname)
		{
			size_t n = (size_t)(dot - p);

			if (n > 255)
				n = 255;
			memcpy(fname, p, n);
			fname[n] = 0;
		}
		if (ext)
		{
			strncpy(ext, dot, 255);
			ext[255] = 0;
		}
	}
	else if (fname)
	{
		strncpy(fname, p, 255);
		fname[255] = 0;
	}
}

void _makepath(char *path, const char *drive, const char *dir,
			   const char *fname, const char *ext)
{
	path[0] = 0;
	if (drive && drive[0])
	{
		strcat(path, drive);
		if (path[strlen(path) - 1] != ':')
			strcat(path, ":");
	}
	if (dir && dir[0])
	{
		strcat(path, dir);
		if (path[strlen(path) - 1] != '/' && path[strlen(path) - 1] != '\\')
			strcat(path, "\\");
	}
	if (fname)
		strcat(path, fname);
	if (ext && ext[0])
	{
		if (ext[0] != '.')
			strcat(path, ".");
		strcat(path, ext);
	}
}

/* ------------------------------------------------------------------ */
/* SYS_FILESYSTEM — dirent over MEMFS, simple '*' / '?' patterns        */
/* ------------------------------------------------------------------ */
static DIR *FindDir = NULL;
static char FindBase[260];
static char FindPat[260];

static int Match(const char *pat, const char *s)
{
	if (!*pat)
		return !*s;
	if (*pat == '*')
		return Match(pat + 1, s) || (*s && Match(pat, s + 1));
	if (*s && (*pat == '?' || *pat == tolower((unsigned char)*s)))
		return Match(pat + 1, s + 1);
	return 0;
}

static int FindFill(SYS_FileInfo *info)
{
	struct dirent *de;
	struct stat st;
	char full[520];

	while ((de = readdir(FindDir)) != NULL)
	{
		if (!Match(FindPat, de->d_name))
			continue;
		strncpy(info->name, de->d_name, sizeof(info->name) - 1);
		info->name[sizeof(info->name) - 1] = 0;
		snprintf(full, sizeof(full), "%s/%s", FindBase, de->d_name);
		info->size = (stat(full, &st) == 0) ? (unsigned long)st.st_size : 0;
		info->wr_date = 0;
		info->wr_time = 0;
		info->attrib = 0;
		info->platform_handle = FindDir;
		return 0;
	}
	return 1;
}

int SYS_FindFirst(const char *pattern, unsigned attr, SYS_FileInfo *info)
{
	char norm[260];
	char *slash;

	(void)attr;
	SYS_FindClose(info);
	NormPath(pattern, norm, sizeof(norm));
	slash = strrchr(norm, '/');
	if (slash)
	{
		*slash = 0;
		strcpy(FindBase, norm);
		strcpy(FindPat, slash + 1);
	}
	else
	{
		strcpy(FindBase, ".");
		strcpy(FindPat, norm);
	}
	FindDir = opendir(FindBase);
	if (!FindDir)
		return 1;
	return FindFill(info);
}

int SYS_FindNext(SYS_FileInfo *info)
{
	return FindDir ? FindFill(info) : 1;
}

void SYS_FindClose(SYS_FileInfo *info)
{
	(void)info;
	if (FindDir)
		closedir(FindDir);
	FindDir = NULL;
}

/* ------------------------------------------------------------------ */
/* msvcrt bits the engine uses (ultoa is in sdl_sys.c)                 */
/* ------------------------------------------------------------------ */
char *ultoa(unsigned long value, char *buf, int radix);

char *ltoa(long value, char *buf, int radix)
{
	if (value < 0 && radix == 10)
	{
		buf[0] = '-';
		ultoa((unsigned long)-value, buf + 1, radix);
		return buf;
	}
	return ultoa((unsigned long)value, buf, radix);
}

char *itoa(int value, char *buf, int radix)
{
	return ltoa(value, buf, radix);
}

/* engine diagnostics (HQ_RESS.C, MALLOC.C, ...) -> browser console */
void PORT_Diag(const char *fmt, ...)
{
	va_list ap;

	va_start(ap, fmt);
	vprintf(fmt, ap);
	va_end(ap);
}

/* Engine features a mod set asks for (docs/MODS.md): its build writes their
 * names, one per line, to "features" next to the game files. No file (the
 * plain game): every feature off, the engine as the original. */
int PORT_Feature(const char *name)
{
	static char list[1024];
	static int read = 0;
	const char *p;
	size_t n = strlen(name);

	if (!read)
	{
		FILE *f = fopen("features", "rb");

		read = 1;
		if (f)
		{
			size_t got = fread(list, 1, sizeof(list) - 1, f);

			list[got] = 0;
			fclose(f);
		}
	}
	for (p = list; *p;)
	{
		const char *e = p;

		while (*e && *e != '\n' && *e != '\r')
			e++;
		if ((size_t)(e - p) == n && !strncmp(p, name, n))
			return 1;
		p = *e ? e + 1 : e;
	}
	return 0;
}

/* Feature hero-models: hero.dat holds one little-endian WORD per scene, the
 * FILE3D.HQR index of that scene's hero 'normal' model (0: Twinsen; the
 * other behaviours follow it). Read once; no file means Twinsen everywhere. */
int PORT_HeroFile3D(int scene)
{
	static unsigned char *table;
	static long count = -1;

	if (count < 0)
	{
		FILE *f = PORT_Feature("hero-models") ? fopen("hero.dat", "rb") : NULL;

		count = 0;
		if (f)
		{
			fseek(f, 0, SEEK_END);
			count = ftell(f) / 2;
			fseek(f, 0, SEEK_SET);
			table = malloc(count * 2);
			if (!table || fread(table, 2, count, f) != (size_t)count)
				count = 0;
			fclose(f);
		}
	}
	if (scene < 0 || scene >= count)
		return 0;
	return table[scene * 2] | (table[scene * 2 + 1] << 8);
}
