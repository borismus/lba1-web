/*
 * web_debug.c — scene jumping / state cheats for the browser build.
 *
 * Compiled with the ENGINE flags (it touches engine globals). The page calls
 * the exported lba_* functions (also while the engine is suspended inside
 * emscripten_sleep — they only record requests); the engine applies them in
 * PORT_DebugHook(), called at the top of every main-loop frame (PERSO.C), where
 * changing NewCube is exactly what a scene-change zone does.
 *
 * The URL drives startup:
 * lba1.html?scene=N[&at=x,y,z][&chapter=C][&items=all][&flags=F,F...][&body=B][&logo=1]
 * (applied when "New game" starts, in place of the opening scene; flags: game
 * flags set to 1, body: the hero's body slot once in scene N; logo: the
 * Adeline Software logo first, as the original shows it, e.g. to record a
 * playthrough).
 */
#include <emscripten.h>
#include "C_EXTERN.H"

static WORD PendingScene = -1;
static WORD PendingAt = 0; /* PendingX/Y/Z valid: enter like a door does */
static WORD PendingX, PendingY, PendingZ;
static WORD PendingChapter = -1;
static WORD PendingGiveAll = 0;
static WORD PendingFlags[16], NbPendingFlags = 0;
static WORD PendingBody = -1, PendingBodyScene = -1;
static WORD AutoStart = 0; /* ?scene= given: skip intro + menu once */
static WORD ShowLogo = 0;  /* ?logo=1: the Adeline logo at boot */

EMSCRIPTEN_KEEPALIVE void lba_jump(int scene)
{
	if (scene >= 0 && scene < 255)
	{
		PendingScene = (WORD)scene;
		PendingAt = 0;
	}
}

/* Jump to a position in a scene, as a door does. The scene's
 * own start position is often off camera, leaving Twinsen invisible. */
EMSCRIPTEN_KEEPALIVE void lba_jump_at(int scene, int x, int y, int z)
{
	lba_jump(scene);
	if (PendingScene == scene)
	{
		PendingX = (WORD)x;
		PendingY = (WORD)y;
		PendingZ = (WORD)z;
		PendingAt = 1;
	}
}

EMSCRIPTEN_KEEPALIVE void lba_set_chapter(int chapter)
{
	PendingChapter = (WORD)chapter;
}

EMSCRIPTEN_KEEPALIVE void lba_give_all(void)
{
	PendingGiveAll = 1;
}

EMSCRIPTEN_KEEPALIVE void lba_set_flag(int index, int value)
{
	if (index >= 0 && index < MAX_FLAGS_GAME)
		ListFlagGame[index] = (UBYTE)value;
}

EMSCRIPTEN_KEEPALIVE int lba_get_flag(int index)
{
	return (index >= 0 && index < MAX_FLAGS_GAME) ? ListFlagGame[index] : -1;
}

EMSCRIPTEN_KEEPALIVE int lba_current_scene(void)
{
	return NumCube;
}

EMSCRIPTEN_KEEPALIVE int lba_current_chapter(void)
{
	return Chapitre;
}

static void GiveAll(void)
{
	int i;

	for (i = 0; i < MAX_INVENTORY; i++)
		ListFlagGame[i] = 1;
	MagicLevel = 4;
	MagicPoint = MagicLevel * 20;
	NbGoldPieces = 500;
	NbFourLeafClover = 5;
	NbCloverBox = 5;
	ListObjet[NUM_PERSO].LifePoint = 50;
}

/* True while a jump waits for the main loop: MESSAGE.C ends dialogs on it. */
int PORT_JumpPending(void)
{
	return PendingScene != -1;
}

/* ?logo=1: PERSO.C shows the Adeline logo at boot (the web build skips it). */
int PORT_DebugLogo(void)
{
	return ShowLogo;
}

/* True while a ?scene= start is pending: PERSO.C skips the logos/intro
 * and GAMEMENU.C picks "New game" without showing the menu. */
int PORT_DebugAutoStart(void)
{
	return AutoStart && PendingScene != -1;
}

/* Called from InitGame() (new game) and every main-loop frame. */
void PORT_DebugHook(void)
{
	if (PendingChapter != -1)
	{
		Chapitre = PendingChapter;
		PendingChapter = -1;
	}
	if (PendingGiveAll)
	{
		GiveAll();
		PendingGiveAll = 0;
	}
	for (; NbPendingFlags > 0; NbPendingFlags--)
		ListFlagGame[PendingFlags[NbPendingFlags - 1]] = 1;
	if (PendingBody != -1 AND PendingScene == -1 AND NumCube == PendingBodyScene)
	{
		InitBody(PendingBody, NUM_PERSO);
		PendingBody = -1;
	}
	if (PendingScene != -1)
	{
		NewCube = PendingScene;
		/* a jump out of a cutscene skips the script that hands the camera
		 * back to Twinsen; scene changes don't reset it */
		NumObjFollow = NUM_PERSO;
		if (FlagMCGA) /* ...nor the zoomed-in cutscene view (LM_ZOOM) */
		{
			ExtInitSvga();
			SetBlackPal();
			FlagFade = TRUE;
			FirstTime = TRUE;
		}
		if (PendingAt)
		{
			/* what a change-cube zone does (OBJECT.C) */
			NewPosX = PendingX;
			NewPosY = PendingY;
			NewPosZ = PendingZ;
			FlagChgCube = 1;
		}
		else
			FlagChgCube = 0; /* the scene's own start position */
		PendingScene = -1;
	}
}

/* A mod's start (docs/MODS.md), from the page (Module.modStart: scene, at
 * x/y/z, and auto: straight in, after the Adeline logo, for a mod not yet
 * played): where "New game" puts the hero. */
static WORD ModScene = -1, ModX, ModY, ModZ, ModAt = 0;

void PORT_ModNewGame(void)
{
	if (ModScene == -1 OR PendingScene != -1)
		return;
	if (ModAt)
		lba_jump_at(ModScene, ModX, ModY, ModZ);
	else
		lba_jump(ModScene);
}

static void ModStartFromPage(void)
{
	int v[5];

	if (!EM_ASM_INT({
		var s = Module.modStart;
		if (!s || typeof s.scene !== 'number') return 0;
		var at = Array.isArray(s.at) && s.at.length == 3;
		HEAP32[$0 >> 2] = s.scene;
		HEAP32[($0 >> 2) + 1] = at ? 1 : 0;
		for (var i = 0; i < 3; i++) HEAP32[($0 >> 2) + 2 + i] = at ? s.at[i] : 0;
		return s.auto ? 2 : 1;
	}, v))
		return;
	ModScene = (WORD)v[0];
	ModAt = (WORD)v[1];
	ModX = (WORD)v[2];
	ModY = (WORD)v[3];
	ModZ = (WORD)v[4];
	if (EM_ASM_INT({ return Module.modStart.auto ? 1 : 0; }))
	{
		PORT_ModNewGame();
		AutoStart = 1;
		ShowLogo = 1;
	}
}

/* URL parameters, read once at boot (main_sdl.c). */
void PORT_DebugInitFromURL(void)
{
	int scene = EM_ASM_INT({
		var v = new URLSearchParams(location.search).get('scene');
		return v === null ? -1 : (parseInt(v, 10) | 0);
	});
	int chapter = EM_ASM_INT({
		var v = new URLSearchParams(location.search).get('chapter');
		return v === null ? -1 : (parseInt(v, 10) | 0);
	});
	int all = EM_ASM_INT({
		return new URLSearchParams(location.search).get('items') === 'all' ? 1 : 0;
	});

	int at[3];
	int hasat = EM_ASM_INT({
		var v = new URLSearchParams(location.search).get('at');
		var a = v ? v.split(',').map(Number) : [];
		if (a.length != 3 || a.some(isNaN)) return 0;
		HEAP32[$0 >> 2] = a[0]; HEAP32[($0 >> 2) + 1] = a[1]; HEAP32[($0 >> 2) + 2] = a[2];
		return 1;
	}, at);

	int flags[16];
	int nflags = EM_ASM_INT({
		var v = new URLSearchParams(location.search).get('flags');
		var a = v ? v.split(',').map(Number).filter(function(n) { return n >= 0 && n < 255; }) : [];
		a = a.slice(0, 16);
		a.forEach(function(n, i) { HEAP32[($0 >> 2) + i] = n; });
		return a.length;
	}, flags);
	int body = EM_ASM_INT({
		var v = new URLSearchParams(location.search).get('body');
		return v === null ? -1 : (parseInt(v, 10) | 0);
	});
	int i;

	ShowLogo = EM_ASM_INT({
		return new URLSearchParams(location.search).get('logo') === '1' ? 1 : 0;
	});
	for (i = 0; i < nflags; i++)
		PendingFlags[NbPendingFlags++] = (WORD)flags[i];
	if (body >= 0 AND scene >= 0)
	{
		PendingBody = (WORD)body;
		PendingBodyScene = (WORD)scene;
	}
	if (scene >= 0)
	{
		if (hasat)
			lba_jump_at(scene, at[0], at[1], at[2]);
		else
			lba_jump(scene);
		AutoStart = 1;
	}
	if (chapter >= 0)
		lba_set_chapter(chapter);
	if (all)
		lba_give_all();
	if (scene < 0)
		ModStartFromPage();
}

/* Hero state for debugging jumps: x, y, z, body, genbody, camera cube x/y/z,
 * flags, workflags, then coins, life, magic, clovers, then the life script
 * offset (OffsetLife) and behaviour (Comportement). */
EMSCRIPTEN_KEEPALIVE int lba_hero_info(int i)
{
	int out[17];
	T_OBJET *h = &ListObjet[NUM_PERSO];

	out[0] = h->PosObjX;
	out[1] = h->PosObjY;
	out[2] = h->PosObjZ;
	out[3] = h->Body;
	out[4] = h->GenBody;
	out[5] = StartXCube;
	out[6] = StartYCube;
	out[7] = StartZCube;
	out[8] = h->Flags;
	out[9] = h->WorkFlags;
	out[10] = NbGoldPieces;
	out[11] = h->LifePoint;
	out[12] = MagicPoint;
	out[13] = NbFourLeafClover;
	out[14] = h->OffsetLife;
	out[15] = Comportement;
	out[16] = NbLittleKeys;
	return (i >= 0 && i < 17) ? out[i] : 0;
}

/* Zone n's fields as stored (x0 y0 z0 x1 y1 z1 type num info0..3), for tests. */
EMSCRIPTEN_KEEPALIVE int lba_zone_info(int n, int i)
{
	T_ZONE *z;

	if (n < 0 || n >= NbZones || i < 0 || i > 11)
		return -32768;
	z = &ListZone[n];
	switch (i)
	{
	case 0: return z->X0;
	case 1: return z->Y0;
	case 2: return z->Z0;
	case 3: return z->X1;
	case 4: return z->Y1;
	case 5: return z->Z1;
	case 6: return z->Type;
	case 7: return z->Num;
	case 8: return z->Info0;
	case 9: return z->Info1;
	case 10: return z->Info2;
	default: return z->Info3;
	}
}

/* Live extras (bonuses, projectiles): -> sprite, x, y, z, flags; -1 if free. */
EMSCRIPTEN_KEEPALIVE int lba_extra_info(int n, int i)
{
	T_EXTRA *e;

	if (n < 0 || n >= MAX_EXTRAS)
		return -32768;
	e = &ListExtra[n];
	switch (i)
	{
	case 0: return e->Sprite;
	case 1: return e->PosX;
	case 2: return e->PosY;
	case 3: return e->PosZ;
	default: return e->Flags;
	}
}

/* Move the hero within the current scene (no reload), for tests. */
EMSCRIPTEN_KEEPALIVE void lba_hero_set(int x, int y, int z)
{
	ListObjet[NUM_PERSO].PosObjX = x;
	ListObjet[NUM_PERSO].PosObjY = y;
	ListObjet[NUM_PERSO].PosObjZ = z;
}

/* Turn the hero to face beta (0..1023; 0 = +z, 256 = +x), for tests. */
EMSCRIPTEN_KEEPALIVE void lba_hero_beta(int beta)
{
	ListObjet[NUM_PERSO].Beta = beta & 1023;
}

/* Set object n's life points, for tests (e.g. a boss down to his last). */
EMSCRIPTEN_KEEPALIVE void lba_obj_life(int n, int life)
{
	if (n >= 0 && n < NbObjets)
		ListObjet[n].LifePoint = (WORD)life;
}

/* Dress the hero in body slot gen (0 normal, 4 nurse uniform...), for tests. */
EMSCRIPTEN_KEEPALIVE void lba_hero_body(int gen)
{
	InitBody((WORD)gen, NUM_PERSO);
}

/* Object n's state for tests: x, y, z, life offset, last track label,
 * move, carried by (-1: nobody), generic anim, beta, anim (HQR index),
 * anim flag, work flags, life points, armour. */
EMSCRIPTEN_KEEPALIVE int lba_obj_info(int n, int i)
{
	T_OBJET *o;

	if (n < 0 || n >= NbObjets)
		return 0;
	o = &ListObjet[n];
	switch (i)
	{
	case 0: return o->PosObjX;
	case 1: return o->PosObjY;
	case 2: return o->PosObjZ;
	case 3: return o->OffsetLife;
	case 4: return o->LabelTrack;
	case 5: return o->Move;
	case 6: return o->CarryBy;
	case 7: return o->GenAnim;
	case 8: return o->Beta;
	case 9: return o->Anim;
	case 10: return o->FlagAnim;
	case 11: return o->WorkFlags;
	case 12: return o->LifePoint;
	case 13: return o->Armure;
	}
	return 0;
}
