# FETCHORA Download Manager - Design Context

This document outlines the design tokens and system architecture for **FETCHORA** (formerly OmniFetch), based on the most recent design system version: **High-Contrast Industrial**.

## Brand & Style
The design system is built on the intersection of high-energy rave aesthetics and industrial precision. It targets power users who value speed, clarity, and a distinct visual edge. The brand personality is bold, "glitchy" yet stable, and highly functional.

## Color Palette

### Primary Signal Colors
- **Cyber Lime**: `#BEF264` (Main CTA, success states, active indicators)
- **Electric Orange**: `#FB923C` (Warnings, secondary interactions, data highlights)
- **Pure Black**: `#000000` (Structural elements, borders, typography)
- **Crisp White**: `#FFFFFF` (Base canvas)

### System Colors (Named Tokens)
- **Background**: `#F9F9F9`
- **Surface**: `#F9F9F9`
- **Surface Container**: `#EEEEEE`
- **Surface Container High**: `#E8E8E8`
- **Surface Container Highest**: `#E2E2E2`
- **Surface Container Low**: `#F3F3F4`
- **Surface Container Lowest**: `#FFFFFF`
- **Error**: `#BA1A1A`
- **Outline**: `#747966`
- **Primary Container**: `#BEF264`

## Typography
The system exclusively utilizes **Space Grotesk** across all levels to reinforce a technical, geometric narrative.

| Token | Font Family | Size | Weight | Line Height | Letter Spacing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Display** | Space Grotesk | 48px | 700 | 1.1 | -0.02em |
| **H1** | Space Grotesk | 32px | 700 | 1.2 | -0.01em |
| **H2** | Space Grotesk | 24px | 600 | 1.2 | 0em |
| **Body LG** | Space Grotesk | 18px | 500 | 1.5 | 0em |
| **Body MD** | Space Grotesk | 16px | 400 | 1.5 | 0em |
| **Label Caps** | Space Grotesk | 12px | 700 | 1.0 | 0.1em |
| **Code** | Space Grotesk | 14px | 400 | 1.4 | 0em |

## Shapes & Layout
- **Border Radius**: 4px (Soft rectangular precision)
- **Borders**: 2px solid black (Primary method of separation)
- **Grid**: 12-column fluid grid with 24px gutters
- **Elevation**: No Z-axis shadows; uses "Hard Shadow" offsets (solid black rectangles) for depth.
