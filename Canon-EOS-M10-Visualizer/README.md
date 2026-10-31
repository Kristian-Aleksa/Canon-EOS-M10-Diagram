# EOS M10 Cutaway

An interactive drawing of a Canon EOS M10 with its EF-M 15–45 mm kit lens, cut in half along the lens axis and clamped on an optical bench, photographing a chess king.

Light from the king passes through the lens's 10 elements in 9 groups and its 7-blade aperture, then through the shutter gate onto the APS-C sensor. The frame goes down a flex cable to the DIGIC 6 processor, and the picture appears on the flipped-up screen.

**Live page:** `docs/index.html` (served by GitHub Pages, see below).

## Using it

| Input | What happens |
|---|---|
| Hover the bench | Slides the king between 0.25 and 0.33 m |
| Click, or Space | Takes a picture: focus, aperture, shutter, readout, review |
| F | Half-press: focuses only |
| A / S, or the buttons | Changes aperture and shutter speed; auto ISO does the rest |
| Arrow keys | Move the king 10 mm at a time |

Left alone, it tours a few settings, including 1/4000 s, where the two curtains cross the gate as a thin slit. The shutter runs 100 times slower than life so you can watch it. With reduced motion on, it shows still frames instead.

The page follows the viewer's light or dark setting. Add `?theme=light` or `?theme=dark` to force one.

## How the numbers work

Everything the figure shows comes from `src/model.mjs`:

- **Focus:** a thin lens at 45 mm. The image distance sets how far the focus group moves, drawn at 0.4 of the thin-lens travel so it fits between its neighbouring groups.
- **Blur:** the blur circle is pupil × |v_subject − v_focus| / v_subject, and it drives the blur on the screen photo.
- **Exposure:** auto ISO in third stops from 100 to 12800, for a scene at EV 9. Past the ends of that range the photo comes out dark or bright by the leftover stops.
- **Shutter:** each curtain takes 3.6 ms to cross the gate, and the second curtain leaves one shutter time after the first.

Some parts are simplified: the lens element shapes are illustrative (the count is real), and the inside layout is arranged so the DIGIC stays visible. The SD card sits with the battery in the grip, where this view can't see it.

## Building

Needs Node 18 or newer; there are no npm dependencies.

```sh
npm run build        # writes docs/index.html
npm run shot         # screenshot to shots/ (needs Chrome installed)
npm run lines        # checks that every drawn line ends on something
```

| Path | Contents |
|---|---|
| `src/model.mjs` | The camera's numbers: optics, exposure, shutter timing |
| `src/build.mjs` | All the geometry; writes the page |
| `src/cut.mjs` | Draws the half-cut turned parts (lens elements, barrels) |
| `src/live.js` | Animation and input: AF, aperture, curtains, rays, screen |
| `src/camera.css` | Colours for the cut faces, glass, blades and screen, in both themes |
| `vendor/anatomy-kit/` | The isometric drawing kit (MIT, see its LICENSE) |
| `tools/` | Headless-Chrome screenshot, scripted-drive and line-end checks |
| `docs/` | The built page, ready for GitHub Pages |

