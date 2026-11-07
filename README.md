# Hydantoin Mechanism Explorer

An interactive map of every mechanism considered for

phenylglyoxal hydrate + *N*-benzyl-*N*′-methyl(thio)urea → 5-phenyl(thio)hydantoins (H⁺ cat., CHCl₃)

The reaction gives two isomers: **P1a** (1-R-3-Me) and **P1b** (1-Me-3-R), with R = benzyl. Each of the 54
mechanism families (M1–M54) is drawn once ending at P1a (A) and once ending at P1b (B), for both the urea and
the thiourea. Species and step IDs (I5a, S3b …) are the same as in the mechflow projects used for the DFT
calculations.

Open `index.html` in a browser. No server or installation is needed, and the page also works straight from
the folder.

## What you can do

- **Mechanisms.** Pick a family and its A or B version. Each step with a transition state has its own colour,
  used for the arrow between the structures and for the curly arrows on the structure before it. Above each
  coloured arrow is a 3D picture of a TS guess. Grey double arrows are proton transfers.
- **Click a structure** to turn it in 3D (3Dmol.js). You can label the key atoms (C5, C4, O5 …), change the
  style, or download the xyz file.
- **Click a step arrow** to open the step in its own window:
  - the diagram: intermediate n with its curly arrows, the TS guess above the arrow, and intermediate n+1;
  - a 2D sketch of the TS, with the bonds that form or break dashed;
  - **3D: TS guess and path**: the 9 images of an IDPP interpolation (ASE NEB module) between the two sides of
    the step, with play and slider controls. The bonds that change are dashed.
- **Network.** Every mechanism in one network, ending at both products. Drag to move, scroll to zoom, and click
  a box or an arrow.
- **Species / Steps.** Searchable lists. The search box also finds mechanisms (`M17`), species (`I52`) and
  steps (`S35a`).
- **Links.** The address can open a view directly, for example `index.html#ch=S&m=M3A&step=S7b` or
  `#ch=O&mol=I7a`.

## The TS guesses

They are not DFT results. For each step, one end is the structure the SCAN starts from. The other end has the
same atoms, with the step's bonds formed or broken and relaxed with a force field (MMFF). ASE's NEB module joins
the two ends with an IDPP interpolation. The TS guess is the image whose scanned distance is closest to a
typical TS value.

The files are in `xyz/ts_guesses/Ch_O|Ch_S/` (`<step>_path.xyz` and `<step>_TS_guess.xyz`) and open with:

```bash
ase gui xyz/ts_guesses/Ch_S/S7b_path.xyz
```

The starting structures of all species are in `xyz/species/`.

## Rebuilding

The site is generated from the study folder by `mechanisms/source/make_website.py` (run by
`mechanisms/source/build_all.sh`). Once the DFT jobs have run, rebuilding adds a "3D: DFT" tab to every step
with a finished OptTS or IRC.
