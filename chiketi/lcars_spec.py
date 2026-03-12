"""Shared LCARS design spec used by pygame and control-panel preview."""

from __future__ import annotations


# Core LCARS palette (TOS v11)
LCARS_GOLD = "#FDCD06"
LCARS_RED = "#BF0F0F"
LCARS_BLUE = "#165FC5"
LCARS_GREEN = "#B9C92F"
LCARS_TEAL = "#11709F"
LCARS_AMBER = "#FF8800"
LCARS_MAROON = "#8B0000"

# Thermal gradient colors
LCARS_THERM_BLUE = "#2288DD"
LCARS_THERM_GREEN = "#22BB44"
LCARS_THERM_YELLOW = "#DDCC00"
LCARS_THERM_ORANGE = "#FF7700"
LCARS_THERM_DARK_RED = "#AA0000"

# ── TNG palette ──
TNG_TANOI = "#FFCC99"
TNG_GOLDEN_TANOI = "#FFCC66"
TNG_NEON_CARROT = "#FF9933"
TNG_LILAC = "#CC99CC"
TNG_ANAKIWA = "#99CCFF"
TNG_EGGPLANT = "#664466"
TNG_MARINER = "#3366CC"
TNG_BAHAMA = "#006699"
TNG_PALE_CANARY = "#FFFF99"
TNG_SUNFLOWER = "#FFCC99"
TNG_ICE = "#99CCFF"
TNG_BLUEY = "#8899FF"
TNG_AFRICAN_VIOLET = "#CC99FF"
TNG_HOPBUSH = "#CC6699"
TNG_MARS = "#FF2200"
TNG_GREEN = "#999933"
TNG_GOLD = "#FFAA00"

TNG_THERM_BLUE = "#99CCFF"
TNG_THERM_GREEN = "#99CC66"
TNG_THERM_YELLOW = "#FFCC66"
TNG_THERM_ORANGE = "#FF9933"
TNG_THERM_DARK_RED = "#CC4444"

# ── DS9/Picard palette ──
DS9_BURNT = "#E7442A"
DS9_STEEL = "#9EA5BA"
DS9_SLATE = "#6D748C"
DS9_NAVY = "#2F3749"
DS9_VOID = "#111419"
DS9_TEAL = "#2A9D8F"
DS9_CYAN = "#66CCCC"
DS9_LAVENDER = "#8888BB"
DS9_PALE = "#AAAACC"
DS9_DEEP_BLUE = "#2A2A55"
DS9_WARM = "#CCAA77"
DS9_ALERT = "#FF4444"

DS9_THERM_BLUE = "#4488AA"
DS9_THERM_GREEN = "#55AA77"
DS9_THERM_YELLOW = "#CCAA44"
DS9_THERM_ORANGE = "#DD7733"
DS9_THERM_DARK_RED = "#BB3333"

# ── Vintage / Scanlines palette ──
VFD_BG = "#060810"
VFD_GLASS = "#0C1018"
VFD_CYAN = "#00FFCC"
VFD_CYAN_DIM = "#009977"
VFD_AMBER = "#FFAA00"
VFD_AMBER_DIM = "#996600"
VFD_GREEN = "#00FF88"
VFD_GREEN_DIM = "#009944"
VFD_RED = "#FF3344"
VFD_RED_DIM = "#992222"
VFD_BLUE = "#4488FF"
VFD_BLUE_DIM = "#224488"
VFD_WHITE = "#CCDDEE"
VFD_DIM = "#334455"
VFD_GRID = "#0D1520"

# ── Vintage / Tubes palette ──
TUBE_BG = "#0A0806"
TUBE_GLASS_TINT = "#181210"
TUBE_CORE = "#FF8833"
TUBE_BRIGHT = "#FF6E0B"
TUBE_WARM = "#FF9944"
TUBE_DIM_EDGE = "#CC5500"
TUBE_BLOOM = "#FF4400"
TUBE_CATHODE = "#1A1410"
TUBE_MESH = "#332820"
TUBE_BAR_CORE = "#FF7733"
TUBE_BAR_STD = "#FF6622"
TUBE_BAR_DIM = "#CC4400"
TUBE_EYE_FULL = "#33FF33"
TUBE_EYE_STD = "#22DD22"
TUBE_EYE_DIM = "#118811"
TUBE_EYE_BG = "#050A05"
TUBE_DEK_ORANGE = "#FF6600"
TUBE_DEK_GUIDE = "#552200"
TUBE_LABEL = "#AA8855"
TUBE_GLASS = "#332818"
TUBE_TUBE_DIM = "#2A1E14"
TUBE_INTERIOR = "#0C0A06"

# ── Vintage / VFD Redux palette ──
VFDR_BG = "#0A0A08"
VFDR_GREEN = "#00DDAA"
VFDR_GREEN_BRIGHT = "#44FFCC"
VFDR_GREEN_DIM = "#008866"
VFDR_GREEN_GHOST = "#0A1A15"
VFDR_AMBER = "#FFAA22"
VFDR_AMBER_BRIGHT = "#FFCC66"
VFDR_AMBER_DIM = "#886611"
VFDR_AMBER_GHOST = "#1A1508"
VFDR_YELLOW = "#DDCC00"
VFDR_YELLOW_BRIGHT = "#FFEE44"
VFDR_YELLOW_DIM = "#887700"
VFDR_YELLOW_GHOST = "#1A1A08"
VFDR_BLUE = "#00D4CC"
VFDR_BLUE_BRIGHT = "#66FFEE"
VFDR_BLUE_DIM = "#007A77"
VFDR_BLUE_GHOST = "#001A1A"
VFDR_RED = "#FF4433"
VFDR_RED_BRIGHT = "#FF7766"
VFDR_RED_DIM = "#882211"
VFDR_GHOST = "#0A1A15"
VFDR_GHOST_OUTLINE = "#0D2219"
VFDR_FILAMENT = "#332211"
VFDR_FILAMENT_WARM = "#443322"
VFDR_GRID = "#1A1A18"
VFDR_SUBSTRATE = "#0A0A08"
VFDR_LABEL = "#556655"

# Shared shape/size tokens
LCARS_PANEL_RADIUS_PX = 2
LCARS_BAR_HEIGHT_PX = 12


def web_spec() -> dict:
    """Return a JSON-serializable spec for the control panel preview."""
    return {
        "colors": {
            "gold": LCARS_GOLD,
            "red": LCARS_RED,
            "blue": LCARS_BLUE,
            "green": LCARS_GREEN,
            "teal": LCARS_TEAL,
            "amber": LCARS_AMBER,
            "maroon": LCARS_MAROON,
            "thermBlue": LCARS_THERM_BLUE,
            "thermGreen": LCARS_THERM_GREEN,
            "thermYellow": LCARS_THERM_YELLOW,
            "thermOrange": LCARS_THERM_ORANGE,
            "thermDarkRed": LCARS_THERM_DARK_RED,
        },
        "tng": {
            "tanoi": TNG_TANOI,
            "goldenTanoi": TNG_GOLDEN_TANOI,
            "neonCarrot": TNG_NEON_CARROT,
            "lilac": TNG_LILAC,
            "anakiwa": TNG_ANAKIWA,
            "eggplant": TNG_EGGPLANT,
            "mariner": TNG_MARINER,
            "paleCanary": TNG_PALE_CANARY,
            "mars": TNG_MARS,
            "thermBlue": TNG_THERM_BLUE,
            "thermGreen": TNG_THERM_GREEN,
            "thermYellow": TNG_THERM_YELLOW,
            "thermOrange": TNG_THERM_ORANGE,
            "thermDarkRed": TNG_THERM_DARK_RED,
        },
        "ds9": {
            "burnt": DS9_BURNT,
            "steel": DS9_STEEL,
            "slate": DS9_SLATE,
            "navy": DS9_NAVY,
            "void": DS9_VOID,
            "teal": DS9_TEAL,
            "cyan": DS9_CYAN,
            "lavender": DS9_LAVENDER,
            "pale": DS9_PALE,
            "warm": DS9_WARM,
            "alert": DS9_ALERT,
            "thermBlue": DS9_THERM_BLUE,
            "thermGreen": DS9_THERM_GREEN,
            "thermYellow": DS9_THERM_YELLOW,
            "thermOrange": DS9_THERM_ORANGE,
            "thermDarkRed": DS9_THERM_DARK_RED,
        },
        "scanlines": {
            "bg": VFD_BG, "glass": VFD_GLASS,
            "cyan": VFD_CYAN, "cyanDim": VFD_CYAN_DIM,
            "amber": VFD_AMBER, "amberDim": VFD_AMBER_DIM,
            "green": VFD_GREEN, "greenDim": VFD_GREEN_DIM,
            "red": VFD_RED, "redDim": VFD_RED_DIM,
            "blue": VFD_BLUE, "blueDim": VFD_BLUE_DIM,
            "white": VFD_WHITE, "dim": VFD_DIM, "grid": VFD_GRID,
        },
        "tubes": {
            "bg": TUBE_BG, "glassTint": TUBE_GLASS_TINT,
            "core": TUBE_CORE, "bright": TUBE_BRIGHT, "warm": TUBE_WARM,
            "dimEdge": TUBE_DIM_EDGE, "bloom": TUBE_BLOOM,
            "cathode": TUBE_CATHODE, "mesh": TUBE_MESH,
            "barCore": TUBE_BAR_CORE, "barStd": TUBE_BAR_STD, "barDim": TUBE_BAR_DIM,
            "eyeFull": TUBE_EYE_FULL, "eyeStd": TUBE_EYE_STD,
            "eyeDim": TUBE_EYE_DIM, "eyeBg": TUBE_EYE_BG,
            "dekOrange": TUBE_DEK_ORANGE, "dekGuide": TUBE_DEK_GUIDE,
            "label": TUBE_LABEL, "glass": TUBE_GLASS,
            "tubeDim": TUBE_TUBE_DIM, "interior": TUBE_INTERIOR,
        },
        "vfd": {
            "bg": VFDR_BG,
            "green": VFDR_GREEN, "greenBright": VFDR_GREEN_BRIGHT,
            "greenDim": VFDR_GREEN_DIM, "greenGhost": VFDR_GREEN_GHOST,
            "amber": VFDR_AMBER, "amberBright": VFDR_AMBER_BRIGHT,
            "amberDim": VFDR_AMBER_DIM, "amberGhost": VFDR_AMBER_GHOST,
            "yellow": VFDR_YELLOW, "yellowBright": VFDR_YELLOW_BRIGHT,
            "yellowDim": VFDR_YELLOW_DIM, "yellowGhost": VFDR_YELLOW_GHOST,
            "blue": VFDR_BLUE, "blueBright": VFDR_BLUE_BRIGHT,
            "blueDim": VFDR_BLUE_DIM, "blueGhost": VFDR_BLUE_GHOST,
            "red": VFDR_RED, "redBright": VFDR_RED_BRIGHT, "redDim": VFDR_RED_DIM,
            "ghost": VFDR_GHOST, "ghostOutline": VFDR_GHOST_OUTLINE,
            "filament": VFDR_FILAMENT, "filamentWarm": VFDR_FILAMENT_WARM,
            "grid": VFDR_GRID, "substrate": VFDR_SUBSTRATE, "label": VFDR_LABEL,
        },
        "sizes": {
            "panel_radius_px": LCARS_PANEL_RADIUS_PX,
            "bar_height_px": LCARS_BAR_HEIGHT_PX,
        },
    }
