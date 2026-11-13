// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import Keycloak from "keycloak-js";
import { config } from "./config";

let instance: Keycloak | null = null;
let initPromise: Promise<boolean> | null = null;

export function getKeycloak(): Keycloak {
  if (!instance) {
    instance = new Keycloak({
      url: config.keycloakUrl,
      realm: config.realm,
      clientId: config.clientId,
    });
  }
  return instance;
}

// Chỉ init một lần (React StrictMode gọi effect hai lần ở môi trường dev).
export function initKeycloak(): Promise<boolean> {
  if (!initPromise) {
    initPromise = getKeycloak().init({
      onLoad: "login-required",
      pkceMethod: "S256",
      checkLoginIframe: false,
    });
  }
  return initPromise;
}
