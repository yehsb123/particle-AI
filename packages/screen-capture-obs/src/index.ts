/**
 * @particle/screen-capture-obs — an OBS capture backend.
 *
 * Copyright (C) 2026 Particle AI contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later — see the LICENSE file beside this package.
 *
 * THIS PACKAGE IS NOT UNDER THE REPOSITORY'S MIT LICENCE. Importing it puts GPL-licensed code in
 * your build, and the GPL's terms then apply to the whole of what you distribute. Nothing in this
 * repository imports it: a process has it only because its own code chose to.
 *
 * It bundles no OBS binary and links no OBS source. It speaks obs-websocket, the server built
 * into OBS Studio 28 and later, over a socket the person opens in OBS themselves.
 */
export * from "./protocol";
export * from "./png";
export * from "./backend";
