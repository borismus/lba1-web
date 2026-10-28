/*
 * web_music.c — LIB_MIDI for the browser: plays the soundtrack GOG ships
 * already rendered (Common/Midi/LBA1-NN.mp3; the page copies the player's
 * into /lba/music/NN.mp3, loader.js) through an <audio> element. No such
 * file (a copy of the game without them): no music.
 *
 * Same trick as platform/nds/nds_music.c: every PlayMidi() call site sets
 * NumXmi = num right before it, and LBA1-NN is XMI entry NN-1, so we play
 * track NumXmi + 1 and ignore the XMI bytes. CDEnable stays 0, so
 * PlayMusic() always takes the MIDI path (area themes are in the set too).
 *
 * Browsers only start audio after a user gesture: if play() is refused,
 * the track starts on the next key press or click.
 *
 * Under speech the music ducks to DUCK of its volume, checked ten times a
 * second (PORT_VoicePlaying, sdl_audio.c), easing down and back up. A new
 * track crossfades with the one playing (XFADE ms).
 */
#include <emscripten.h>
#include "port.h"

extern short NumXmi;

WORD Midi_Driver_Enable = 1;
LONG MaxVolume = 100;

EM_JS(void, web_music_duck_start, (void), {
	var m = Module.music || (Module.music = { el: new Audio(), vol: 1, fade: 0 });
	if (m.ducker) return;
	var DUCK = 0.12;
	m.duck = 1;
	m.ducker = setInterval(function() {
		var want = Module._PORT_VoicePlaying() ? DUCK : 1;
		if (m.duck == want) return;
		m.duck = want < m.duck ? Math.max(want, m.duck - 0.3) : Math.min(want, m.duck + 0.06);
		if (!m.fading) m.el.volume = m.vol * m.duck;
	}, 100);
});

EM_JS(void, web_music_play, (int n), {
	var m = Module.music || (Module.music = { el: new Audio(), vol: 1, fade: 0 });
	var nn = (n < 10 ? "0" : "") + n;
	m.urls = m.urls || {};
	if (!(nn in m.urls)) {
		try {
			m.urls[nn] = URL.createObjectURL(new Blob([FS.readFile("/lba/music/" + nn + ".mp3")], { type: "audio/mpeg" }));
		} catch (e) {
			m.urls[nn] = null;
		}
	}
	var name = m.urls[nn];
	if (!name) { m.el.pause(); m.playing = false; return; }
	var XFADE = 600;
	clearInterval(m.fade);
	m.fading = false;
	if (m.playing && !m.el.paused) {
		/* fade the old track out on its own element */
		var old = m.el, dv = old.volume / (XFADE / 50);
		var t = setInterval(function() {
			if (old.volume - dv <= 0.001) { clearInterval(t); old.pause(); }
			else old.volume -= dv;
		}, 50);
		m.el = new Audio();
	}
	m.el.src = name;
	m.el.volume = m.vol * (m.duck || 1);
	if (Module.onMusicElement) Module.onMusicElement(m.el); /* shell.html's recorder */
	m.playing = true;
	m.el.onended = function() { m.playing = false; };
	m.el.onerror = function() { m.playing = false; };
	m.el.play().catch(function() {
		/* no user gesture yet: start on the next one */
		var go = function() {
			removeEventListener("keydown", go, true);
			removeEventListener("pointerdown", go, true);
			if (m.playing && m.el.paused) m.el.play().catch(function() {});
		};
		addEventListener("keydown", go, true);
		addEventListener("pointerdown", go, true);
	});
});

EM_JS(void, web_music_stop, (void), {
	var m = Module.music;
	if (!m) return;
	clearInterval(m.fade);
	m.el.pause();
	m.playing = false;
});

EM_JS(int, web_music_playing, (void), {
	return Module.music && Module.music.playing ? 1 : 0;
});

EM_JS(void, web_music_volume, (int v), {
	var m = Module.music || (Module.music = { el: new Audio(), vol: 1, fade: 0 });
	m.vol = Math.max(0, Math.min(100, v)) / 100;
	if (!m.fading) m.el.volume = m.vol * (m.duck || 1);
});

EM_JS(void, web_music_fade_out, (int sec), {
	var m = Module.music;
	if (!m || !m.playing) return;
	var el = m.el, steps = Math.max(1, sec * 20), dv = el.volume / steps;
	clearInterval(m.fade);
	m.fading = true;
	m.fade = setInterval(function() {
		if (el.volume - dv <= 0.001) {
			clearInterval(m.fade);
			el.pause();
			m.playing = false;
			m.fading = false;
		} else {
			el.volume -= dv;
		}
	}, 50);
});

LONG InitMidiDLL(UBYTE *driverpathname)
{
	(void)driverpathname;
	return 1;
}

static char *NoIdent[] = { "" };
static LONG NoVars[1];

void AskMidiVars(char ***listidentifier, LONG **ptrvars)
{
	*listidentifier = NoIdent;
	*ptrvars = NoVars;
}

LONG InitMidi(void) { return 1; }
void ClearMidi(void) { web_music_stop(); }
void InitPathMidiSampleFile(UBYTE *path) { (void)path; }
void PlayMidi(UBYTE *ail_buffer)
{
	(void)ail_buffer;
	web_music_duck_start(); /* once */
	web_music_play(NumXmi + 1);
}
void StopMidi(void) { web_music_stop(); }
LONG IsMidiPlaying(void) { return web_music_playing(); }
void FadeMidiDown(WORD nbsec) { web_music_fade_out(nbsec); }
void FadeMidiUp(WORD nbsec) { (void)nbsec; }
void WaitFadeMidi(void) {}
void VolumeMidi(WORD volume) { web_music_volume(volume); }
void DoLoopMidi(void) {}

void InitTimer(void);
void InitMidiTimer(void)
{
	InitTimer();
}
