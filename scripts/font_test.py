"""Font size test — displays sample text at sizes 12–36 on the GeeekPi display."""

import os
import sys

import pygame

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SAMPLE = "CPU: 52°C  Load: [████░░] 78%  VRAM: 18/24G"
BG = (10, 10, 10)
GREEN = (0, 255, 65)
DIM = (85, 85, 85)


def main() -> None:
    pygame.init()
    screen = pygame.display.set_mode((1024, 600), pygame.FULLSCREEN | pygame.NOFRAME)
    pygame.mouse.set_visible(False)
    pygame.display.set_caption("font size test")

    screen.fill(BG)

    y = 10
    for size in range(12, 38, 2):
        font = pygame.font.Font(FONT_PATH, size)

        # Size label
        label = font.render(f"{size}px: ", True, DIM)
        screen.blit(label, (10, y))

        # Sample text
        text = font.render(SAMPLE, True, GREEN)
        screen.blit(text, (10 + label.get_width(), y))

        y += text.get_height() + 6

        if y > 580:
            break

    pygame.display.flip()

    # Wait for keypress to exit
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.KEYDOWN:
                running = False

    pygame.quit()


if __name__ == "__main__":
    main()
