#!/usr/bin/env python3
"""
generate_manual.py — Generate a 1-page PDF user guide for the Fruit TV Remote Panel.

Screenshot is centred on the page. Left-column callouts sit to the left of the
image (right-aligned). Right-column callouts sit to the right (left-aligned).
Leader lines terminate at the EDGE of each UI element, not its centre.
Power callout uses a horizontal stub + diagonal final segment.

Usage:
    python3 generate_manual.py [output_path]

Default output: images/fruittv_remote_manual.pdf
Requires: reportlab (auto-installed), Pillow (already in venv)
"""

import sys, subprocess, importlib, pathlib, io, datetime


# ── 0. Bootstrap reportlab ────────────────────────────────────────────────────

def _ensure_reportlab():
    try:
        import reportlab  # noqa: F401
    except ImportError:
        print("reportlab not found — installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "reportlab"])
        importlib.invalidate_caches()

_ensure_reportlab()

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.lib import colors
from PIL import Image


# ── 1. Paths ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = pathlib.Path(__file__).parent
IMG_SRC    = SCRIPT_DIR / "images" / "fruittv extension screenshot.png"
OUTPUT_PDF = SCRIPT_DIR / "images" / "fruittv_remote_manual.pdf"


# ── 2. Page geometry ──────────────────────────────────────────────────────────

PAGE_W, PAGE_H = A4          # 595.27 × 841.89 pt
MARGIN = 36

TITLE_Y        = PAGE_H - MARGIN - 22
RULE_Y         = TITLE_Y - 7
IMG_PDF_Y_BOT  = MARGIN + 20
IMG_PDF_HEIGHT = RULE_Y - 10 - IMG_PDF_Y_BOT   # ≈ 711 pt

# img_left / img_right computed dynamically in generate_pdf after loading image.

LABEL_GAP   = 8     # pt between image edge and first label character
DIAG_EXTRA  = 14    # extra rightward shift for the Power diagonal endpoint
TIP_RADIUS  = 2.5   # small dot at line terminus
LINE_H      = 8.5   # body-line leading


# ── 3. Colours ────────────────────────────────────────────────────────────────

ACCENT      = colors.HexColor('#C0392B')
DARK_NAVY   = colors.HexColor('#1A1A2E')
MID_GREY    = colors.HexColor('#4A4A4A')
LIGHT_GREY  = colors.HexColor('#CCCCCC')
FOOTER_GREY = colors.HexColor('#888888')


# ── 4. Callout data ───────────────────────────────────────────────────────────
# (title, body_lines, ex_px, ey_px, side, y_nudge_pt, line_style)
#
# ex, ey     = EDGE of hit-region in SCREENSHOT pixels (origin top-left, Y-down)
#              left-col items: LEFT edge of button
#              right-col items: RIGHT edge of button
# side       = 'left'  → label placed LEFT  of image (right-aligned)
#              'right' → label placed RIGHT of image (left-aligned)
# y_nudge    = shift label up (+) or down (-) in PDF points to avoid overlap;
#              triggers an elbow in the leader line
# line_style = 'normal'          → horizontal + optional vertical elbow
#              'diagonal_elbow'  → horizontal stub from target, then diagonal to label
#              'target_diagonal' → diagonal from target to breakpoint, then horizontal to label
#                                  ("horizontal at first, diagonal approaching target")

CALLOUTS = [
    # ── GNOME panel strip ────────────────────────────────────────────────────
    ("Play / Pause",
     [],
     20, 20, 'left', -10, 'normal'),

    ("Open Remote",
     [],
     140, 20, 'right', 0, 'normal'),

    # ── Remote top row ────────────────────────────────────────────────────────
    ("Device Manager",
     [],
     30, 85, 'left', 0, 'normal'),

    # Power above Connection LED in right column; both use target_diagonal
    # (horizontal at label end, diagonal approaching the target button/LED)
    ("Power",
     [],
     213, 85, 'right', +20, 'target_diagonal'),

    ("Connection LED",
     [],
     128, 87, 'right', -40, 'target_diagonal'),

    # ── D-pad / trackpad ──────────────────────────────────────────────────────
    ("D-Pad / Trackpad",
     [],
     15, 224, 'left', 0, 'normal'),

    # ── Skip back / forward ───────────────────────────────────────────────────
    ("Skip Back",
     [],
     8, 311, 'left', 0, 'normal'),

    ("Skip Forward",
     [],
     233, 311, 'right', 0, 'normal'),

    # ── Menu row ──────────────────────────────────────────────────────────────
    ("Back",
     [],
     29, 372, 'left', 0, 'normal'),

    ("Home",
     [],
     209, 373, 'right', 0, 'normal'),

    # ── Playback / volume ─────────────────────────────────────────────────────
    ("Play / Pause",
     [],
     30, 467, 'left', 0, 'normal'),

    ("Volume +",
     [],
     210, 466, 'right', 0, 'normal'),

    # ── App selector / volume ─────────────────────────────────────────────────
    ("App Selector",
     [],
     29, 562, 'left', 0, 'normal'),

    ("Volume \u2212",
     [],
     211, 563, 'right', 0, 'normal'),

    # ── Quick-launch grid ─────────────────────────────────────────────────────
    ("Quick-launch Apps",
     [],
     20, 665, 'left', 0, 'normal'),

    # ── Text input ────────────────────────────────────────────────────────────
    ("Text Input",
     [],
     20, 960, 'left', 0, 'normal'),
]


# ── 5. Image helper ───────────────────────────────────────────────────────────

def load_image(path):
    """Return (ImageReader, w_px, h_px) composited over white."""
    img = Image.open(path).convert("RGBA")
    bg  = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    rgb = bg.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf), img.width, img.height


def px_to_pt(ex, ey, scale, img_h, img_left):
    """Screenshot pixel (Y-down) → PDF point (Y-up)."""
    return img_left + ex * scale, IMG_PDF_Y_BOT + (img_h - ey) * scale


# ── 6. Drawing helpers ────────────────────────────────────────────────────────

def draw_tip(c, x, y):
    """Small filled circle at the line terminus — no number."""
    c.setFillColor(ACCENT)
    c.circle(x, y, TIP_RADIUS, fill=1, stroke=0)


def draw_leader(c, dot_x, dot_y, img_left, img_right, side, label_y, line_style):
    """
    Draw the leader line from terminal dot to the label zone.

    'normal':
        left-col  → horizontal left  + optional vertical elbow
        right-col → horizontal right + optional vertical elbow
    'diagonal_elbow':
        horizontal stub from target rightward, then diagonal to label.
    'target_diagonal':
        diagonal from target to a breakpoint at the image edge,
        then horizontal to the label.  Reads as "horizontal at label end,
        diagonal approaching the target."
    """
    c.setStrokeColor(ACCENT)
    c.setLineWidth(0.6)

    if line_style == 'diagonal_elbow':
        x_break = img_right + LABEL_GAP
        x_diag  = x_break + DIAG_EXTRA
        c.line(dot_x, dot_y, x_break, dot_y)     # horizontal stub
        c.line(x_break, dot_y, x_diag, label_y)  # diagonal to label

    elif line_style == 'target_diagonal':
        x_break = img_right + LABEL_GAP           # breakpoint: image edge
        x_label = x_break + DIAG_EXTRA            # where label text begins
        c.line(dot_x, dot_y, x_break, label_y)   # diagonal: target → breakpoint
        c.line(x_break, label_y, x_label, label_y)  # horizontal: breakpoint → label

    elif side == 'left':
        x_edge = img_left - LABEL_GAP
        c.line(dot_x, dot_y, x_edge, dot_y)
        if abs(label_y - dot_y) > 1:
            c.line(x_edge, dot_y, x_edge, label_y)

    else:  # right, normal
        x_edge = img_right + LABEL_GAP
        c.line(dot_x, dot_y, x_edge, dot_y)
        if abs(label_y - dot_y) > 1:
            c.line(x_edge, dot_y, x_edge, label_y)


def draw_label(c, x, y, title, body_lines, side):
    """
    Bold title + grey body. No numbered badge.

    side='left'  → right-aligned at x  (label is left of image)
    side='right' → left-aligned  at x  (label is right of image)
    """
    if side == 'left':
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(DARK_NAVY)
        c.drawRightString(x, y, title)
        c.setFont("Helvetica", 6.5)
        c.setFillColor(MID_GREY)
        by = y - LINE_H
        for line in body_lines:
            c.drawRightString(x, by, line)
            by -= LINE_H
    else:
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(DARK_NAVY)
        c.drawString(x, y, title)
        c.setFont("Helvetica", 6.5)
        c.setFillColor(MID_GREY)
        by = y - LINE_H
        for line in body_lines:
            c.drawString(x, by, line)
            by -= LINE_H


# ── 7. PDF generation ─────────────────────────────────────────────────────────

def generate_pdf(output_path=None):
    if output_path is None:
        output_path = str(OUTPUT_PDF)

    img_reader, img_w, img_h = load_image(IMG_SRC)

    scale     = IMG_PDF_HEIGHT / img_h
    img_pdf_w = img_w * scale
    img_left  = (PAGE_W - img_pdf_w) / 2
    img_right = img_left + img_pdf_w

    c = canvas.Canvas(str(output_path), pagesize=A4)
    c.setTitle("Fruit TV Remote Panel — User Guide")
    c.setAuthor("Fruit TV Remote Panel")

    # ── Title ─────────────────────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 16)
    c.setFillColor(DARK_NAVY)
    c.drawString(MARGIN, TITLE_Y, "Fruit TV Remote Panel \u2014 User Guide")
    c.setStrokeColor(LIGHT_GREY)
    c.setLineWidth(0.5)
    c.line(MARGIN, RULE_Y, PAGE_W - MARGIN, RULE_Y)

    # ── Footer ────────────────────────────────────────────────────────────────
    foot_y = MARGIN + 6
    c.setFont("Helvetica", 7)
    c.setFillColor(FOOTER_GREY)
    c.drawString(MARGIN, foot_y,
                 "Fruit TV Remote Panel for GNOME Shell  \u2022  GNOME Extension")
    c.drawRightString(PAGE_W - MARGIN, foot_y,
                      datetime.date.today().strftime("%B %Y"))
    c.setStrokeColor(LIGHT_GREY)
    c.setLineWidth(0.5)
    c.line(MARGIN, foot_y + 12, PAGE_W - MARGIN, foot_y + 12)

    # ── Screenshot (centred) ──────────────────────────────────────────────────
    c.drawImage(img_reader,
                img_left, IMG_PDF_Y_BOT,
                width=img_pdf_w, height=IMG_PDF_HEIGHT,
                preserveAspectRatio=True)
    c.setStrokeColor(LIGHT_GREY)
    c.setLineWidth(0.5)
    c.rect(img_left, IMG_PDF_Y_BOT, img_pdf_w, IMG_PDF_HEIGHT, fill=0, stroke=1)

    # ── Callouts ──────────────────────────────────────────────────────────────
    for title, body_lines, ex, ey, side, y_nudge, line_style in CALLOUTS:
        dot_x, dot_y = px_to_pt(ex, ey, scale, img_h, img_left)
        label_y = dot_y + y_nudge

        if line_style in ('diagonal_elbow', 'target_diagonal'):
            label_x = img_right + LABEL_GAP + DIAG_EXTRA
            label_side = 'right'
        elif side == 'left':
            label_x   = img_left - LABEL_GAP
            label_side = 'left'
        else:
            label_x   = img_right + LABEL_GAP
            label_side = 'right'

        draw_leader(c, dot_x, dot_y, img_left, img_right, side, label_y, line_style)
        draw_tip(c, dot_x, dot_y)          # draw tip on top of line start
        draw_label(c, label_x, label_y, title, body_lines, label_side)

    c.save()
    print(f"PDF written to: {output_path}")


# ── 8. Entry point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else None
    generate_pdf(out)
