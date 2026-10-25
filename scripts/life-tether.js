/**
 * Life Tether Module for Foundry VTT (D&D 5e)
 *
 * Automates the "Life Tether" spell:
 * - Upcasting target validation (Levels 2, 4, 6, 8)
 * - Saving throw validation via Midi-QOL (with graceful fallback if auto-saves are disabled)
 * - Cross-client ActiveEffect creation via GM delegation
 * - Dynamic visual beam using Sequencer & JB2A (supporting Patreon Green, Free Blue, and dynamic search)
 * - True 50% damage reduction on caster and direct necrotic redirection to target(s) via midi-qol.preTargetDamageApplication
 * - Direct HP damage deduction on tethered target using Midi-QOL / D&D 5e damage application
 * - Manual damage reduction fallback via dnd5e.preApplyDamage
 * - Real-time Line-of-sight tracking via wall collision detection
 * - Clean cleanup of effects and visuals on expiration or manual deletion
 */

const MODULE_ID = "life-tether-spell";
const SPELL_NAMES = ["life tether", "lebensfaden"];

// Track line-of-sight break state between pairs to avoid chat spamming on every movement step
const losWarningTracker = new Map();

Hooks.once("init", () => {
  console.log(`[${MODULE_ID}] Initializing Life Tether module...`);
});

Hooks.once("ready", () => {
  console.log(`[${MODULE_ID}] Ready check.`);
  if (!game.modules.get("midi-qol")?.active) {
    ui.notifications.warn(`Life Tether: "Midi-QOL" ist nicht aktiv. Die automatische Schadens- und Rettungswurf-Logik erfordert Midi-QOL.`);
  }
  if (!game.modules.get("sequencer")?.active) {
    ui.notifications.warn(`Life Tether: "Sequencer" ist nicht aktiv. Die visuellen Strahl-Effekte erfordern Sequencer.`);
  }
});

/**
 * Finds the best available beam or tether animation asset in Sequencer database.
 * Supports JB2A Patreon, JB2A Free, and dynamic fallback search.
 */
function getTetherBeamFile() {
  if (typeof Sequencer?.Database?.entryExists !== "function") return null;

  const candidatePaths = [
    "jb2a.energy_beam.normal.green", // JB2A Patreon
    "jb2a.energy_beam.normal.blue",  // JB2A Free
    "jb2a.ray_of_enfeeblement.green",
    "jb2a.tether.01.blue",
    "jb2a.witch_bolt.blue",
    "jb2a.eldritch_blast.purple"
  ];

  for (const path of candidatePaths) {
    if (Sequencer.Database.entryExists(path)) {
      return path;
    }
  }

  // Dynamic search in Sequencer database
  if (typeof Sequencer.Database.search === "function") {
    const beamMatches = Sequencer.Database.search("energy_beam");
    if (beamMatches?.length > 0) return beamMatches[0];

    const tetherMatches = Sequencer.Database.search("tether");
    if (tetherMatches?.length > 0) return tetherMatches[0];

    const generalBeamMatches = Sequencer.Database.search("beam");
    if (generalBeamMatches?.length > 0) return generalBeamMatches[0];
  }

  return null;
}

/**
 * Safely creates an ActiveEffect on an actor across client permission boundaries.
 */
async function createEffectSafely(actor, effectData) {
  if (!actor) return null;

  if (actor.canUserModify(game.user, "update")) {
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    return created?.[0] ?? null;
  }

  if (globalThis.MidiQOL?.socket) {
    return await globalThis.MidiQOL.socket().executeAsGM("createEffects", {
      actorUuid: actor.uuid,
      effects: [effectData]
    });
  }

  try {
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
    return created?.[0] ?? null;
  } catch (err) {
    console.error(`[${MODULE_ID}] Fehler beim Erstellen des ActiveEffects auf ${actor.name}:`, err);
    return null;
  }
}

/**
 * Safely removes an ActiveEffect from an actor across client permission boundaries.
 */
async function removeEffectSafely(actor, effectId) {
  if (!actor || !effectId) return;

  const effect = actor.effects.get(effectId);
  if (!effect) return;

  if (actor.canUserModify(game.user, "update")) {
    await effect.delete();
    return;
  }

  if (globalThis.MidiQOL?.socket) {
    await globalThis.MidiQOL.socket().executeAsGM("removeEffects", {
      actorUuid: actor.uuid,
      effects: [effectId]
    });
    return;
  }

  try {
    await effect.delete();
  } catch (err) {
    console.error(`[${MODULE_ID}] Fehler beim Löschen des ActiveEffects auf ${actor.name}:`, err);
  }
}

/**
 * Safely applies damage directly to a target token actor so HP is actually deducted.
 * Supports Midi-QOL applyTokenDamage, D&D 5e actor.applyDamage, and GM-delegated updates.
 */
async function applyDirectDamage(targetToken, amount, damageType = "necrotic") {
  if (!targetToken?.actor || amount <= 0) return;
  const targetActor = targetToken.actor;

  // 1. Midi-QOL applyTokenDamage: factors in resistances/immunities and commits damage directly to HP
  if (typeof globalThis.MidiQOL?.applyTokenDamage === "function") {
    try {
      await globalThis.MidiQOL.applyTokenDamage(
        [{ damage: amount, type: damageType }],
        amount,
        new Set([targetToken.document ?? targetToken]),
        null,
        new Set(),
        {
          forceApply: true,
          updateContext: { [MODULE_ID]: { isDamageTransfer: true } }
        }
      );
      return;
    } catch (err) {
      console.warn(`[${MODULE_ID}] MidiQOL.applyTokenDamage fehlgeschlagen, versuche actor.applyDamage:`, err);
    }
  }

  // 2. D&D 5e native actor.applyDamage
  if (typeof targetActor.applyDamage === "function") {
    try {
      await targetActor.applyDamage([{ value: amount, type: damageType }]);
      return;
    } catch (err) {
      console.warn(`[${MODULE_ID}] targetActor.applyDamage fehlgeschlagen:`, err);
    }
  }

  // 3. Direct HP calculation fallback
  const currentHp = targetActor.system.attributes?.hp?.value ?? 0;
  const newHp = Math.max(0, currentHp - amount);
  if (targetActor.canUserModify(game.user, "update")) {
    await targetActor.update({ "system.attributes.hp.value": newHp });
  } else if (globalThis.MidiQOL?.socket) {
    await globalThis.MidiQOL.socket().executeAsGM("updateActor", {
      actorUuid: targetActor.uuid,
      updates: { "system.attributes.hp.value": newHp }
    });
  }
}

/**
 * 1. Spell Cast & Target Assignment: midi-qol.RollComplete
 * Triggers after the spell roll and saves have completed.
 */
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  if (!workflow.item) return;

  // Prevent damage transfer items or sub-workflows from triggering the spell activation
  if (workflow.item.flags?.[MODULE_ID]?.isDamageTransfer) return;
  const rawItemName = workflow.item.name?.trim().toLowerCase() ?? "";
  if (rawItemName.includes("übertragung") || rawItemName.includes("transfer")) return;

  const isLifeTether = SPELL_NAMES.some(name => rawItemName.includes(name)) ||
    Boolean(workflow.item.flags?.[MODULE_ID]?.isLifeTether);

  if (!isLifeTether) return;

  console.log(`[${MODULE_ID}] Life Tether Zauberwurf erkannt. Starte Verarbeitungsroutine...`);

  // Resolve caster token and actor reliably
  const casterActor = workflow.actor;
  const casterToken = workflow.token ??
    casterActor?.getActiveTokens()[0] ??
    canvas.tokens.get(workflow.tokenId);

  if (!casterToken || !casterActor) {
    console.warn(`[${MODULE_ID}] Caster Token oder Actor konnte nicht aufgelöst werden.`);
    return;
  }

  // Upcasting calculation:
  // Level 2 -> 1 target
  // Level 4 -> 2 targets
  // Level 6 -> 3 targets
  // Level 8 -> 4 targets
  const castLevel = workflow.castData?.castLevel ?? workflow.item.system?.level ?? 2;
  const maxTargets = 1 + Math.max(0, Math.floor((castLevel - 2) / 2));

  // Determine valid targets based on failed saves (or workflow targets fallback)
  let validTargets = [];
  if (workflow.failedSaves && workflow.failedSaves.size > 0) {
    validTargets = Array.from(workflow.failedSaves);
  } else if (workflow.saves && workflow.saves.size > 0 && (!workflow.failedSaves || workflow.failedSaves.size === 0)) {
    // Saves were rolled and all targets succeeded
    validTargets = [];
  } else if (workflow.targets && workflow.targets.size > 0) {
    // Saves were not automated through Midi-QOL: fallback to targeted tokens
    validTargets = Array.from(workflow.targets);
  }

  // Normalize validTargets to Token placeables
  validTargets = validTargets.map(t => (t.document ? t : t.object ?? canvas.tokens.get(t.id))).filter(Boolean);

  if (validTargets.length === 0) {
    console.log(`[${MODULE_ID}] Keine gültigen Ziele für Life Tether gefunden.`);
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: casterToken }),
      content: `
        <div class="dnd5e chat-card">
          <header class="card-header flexrow">
            <img src="${workflow.item.img}" title="${workflow.item.name}" width="36" height="36"/>
            <h3 class="item-name">${workflow.item.name}</h3>
          </header>
          <div class="card-content">
            <p><strong>Kein Ziel angebunden.</strong> Alle Ziele haben ihren Rettungswurf bestanden oder es wurden keine Ziele anvisiert.</p>
          </div>
        </div>
      `
    });
    return;
  }

  // Target count validation according to upcasting limit
  if (validTargets.length > maxTargets) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: casterToken }),
      content: `
        <div class="dnd5e chat-card">
          <div class="card-content">
            <p><em>Hinweis zu ${workflow.item.name}:</em> Bei Zaubergrad ${castLevel} können maximal <b>${maxTargets}</b> Ziel(e) gebunden werden. Die ersten ${maxTargets} Ziele werden angebunden.</p>
          </div>
        </div>
      `
    });
    validTargets = validTargets.slice(0, maxTargets);
  }

  const spellDurationSeconds = 60; // 1 minute default
  const spellDurationRounds = 10;
  const spellIcon = workflow.item.img || "icons/magic/death/hand-dirt-undead-zombie.webp";

  for (const targetToken of validTargets) {
    const targetActor = targetToken.actor;
    if (!targetActor) continue;

    const effectTag = `life-tether-${casterToken.id}-${targetToken.id}`;

    // 1. Create Active Effect on Target (both img for v12 and icon for v11 compatibility)
    const targetEffectData = {
      name: `Life Tethered (${casterToken.name})`,
      img: spellIcon,
      icon: spellIcon,
      origin: workflow.item.uuid,
      duration: {
        seconds: spellDurationSeconds,
        rounds: spellDurationRounds
      },
      flags: {
        [MODULE_ID]: {
          isTarget: true,
          casterTokenId: casterToken.id,
          casterActorId: casterActor.id,
          targetTokenId: targetToken.id,
          targetActorId: targetActor.id,
          effectTag: effectTag,
          castLevel: castLevel
        }
      }
    };
    await createEffectSafely(targetActor, targetEffectData);

    // 2. Create Active Effect on Caster
    const casterEffectData = {
      name: `Life Tether (${targetToken.name})`,
      img: spellIcon,
      icon: spellIcon,
      origin: workflow.item.uuid,
      duration: {
        seconds: spellDurationSeconds,
        rounds: spellDurationRounds
      },
      flags: {
        [MODULE_ID]: {
          isCaster: true,
          casterTokenId: casterToken.id,
          casterActorId: casterActor.id,
          targetTokenId: targetToken.id,
          targetActorId: targetActor.id,
          effectTag: effectTag,
          castLevel: castLevel
        }
      }
    };
    await createEffectSafely(casterActor, casterEffectData);

    // 3. Sequencer Visual Beam
    if (game.modules.get("sequencer")?.active && typeof Sequence !== "undefined") {
      Sequencer.EffectManager.endEffects({ name: effectTag });

      const beamFile = getTetherBeamFile();
      if (beamFile) {
        console.log(`[${MODULE_ID}] Starte Sequencer-Strahl mit Asset: ${beamFile}`);
        const sequence = new Sequence();
        const effect = sequence.effect()
          .file(beamFile)
          .attachTo(casterToken, { bindVisibility: false })
          .stretchTo(targetToken, { attachTo: true, bindVisibility: false })
          .persist()
          .name(effectTag);

        // Transform non-green assets (such as JB2A Free blue beam) into vibrant necrotic green
        if (!beamFile.toLowerCase().includes("green")) {
          effect.tint("#00ff55");
        }

        sequence.play();
      } else {
        console.warn(`[${MODULE_ID}] Kein JB2A Strahl-Asset im Sequencer-Katalog gefunden.`);
        ui.notifications.warn(`Life Tether: Kein JB2A Strahl-Effekt gefunden. Installiere das Modul JB2A (Free oder Patreon) für die Animation.`);
      }
    }

    // 4. Chat Confirmation
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: casterToken }),
      content: `
        <div class="dnd5e chat-card">
          <header class="card-header flexrow">
            <img src="${spellIcon}" title="${workflow.item.name}" width="36" height="36"/>
            <h3 class="item-name">${workflow.item.name} aktiviert!</h3>
          </header>
          <div class="card-content">
            <p>Ein nekrotischer Lebensfaden verbindet <b>${casterToken.name}</b> mit <b>${targetToken.name}</b>.</p>
            <p><em>Wirkung:</em> 50% des Schadens, den ${casterToken.name} erleidet, wird abgewehrt und direkt als nekrotischer Schaden auf ${targetToken.name} übertragen.</p>
          </div>
        </div>
      `
    });
  }
});

/**
 * 2. True Damage Redirection: midi-qol.preTargetDamageApplication
 * Intercepts incoming damage on the caster BEFORE it is applied:
 * - Halves incoming damage on the caster (50% reduction).
 * - Directly inflicts the 50% as necrotic damage on the target token's HP.
 */
Hooks.on("midi-qol.preTargetDamageApplication", async (token, { item, workflow, damageItem }) => {
  // Prevent infinite loops if our own transfer damage is being applied
  if (item?.flags?.[MODULE_ID]?.isDamageTransfer || workflow?.item?.flags?.[MODULE_ID]?.isDamageTransfer) {
    return true;
  }

  const actor = token?.actor;
  if (!actor) return true;

  // Check if this token is a Caster with active Life Tether effect(s)
  const casterEffects = actor.effects.filter(e =>
    !e.disabled && e.getFlag(MODULE_ID, "isCaster")
  );
  if (casterEffects.length === 0) return true;

  const incomingDamage = damageItem.appliedDamage ?? damageItem.hpDamage ?? 0;
  if (incomingDamage <= 0) return true;

  // Calculate 50% redirect (rounded down)
  const transferDamage = Math.floor(incomingDamage * 0.5);
  if (transferDamage <= 0) return true;

  const newCasterDamage = incomingDamage - transferDamage;

  console.log(`[${MODULE_ID}] preTargetDamageApplication abgefangen: Caster ${token.name} Schaden ${incomingDamage} -> reduziert auf ${newCasterDamage}, ${transferDamage} umgeleitet.`);

  // Mutate damageItem to reduce caster's damage by 50%
  damageItem.appliedDamage = newCasterDamage;
  if (damageItem.hpDamage !== undefined) {
    damageItem.hpDamage = Math.min(damageItem.hpDamage, newCasterDamage);
  }
  if (damageItem.newHP !== undefined && damageItem.oldHP !== undefined) {
    damageItem.newHP = Math.max(0, damageItem.oldHP - newCasterDamage);
  }

  // Adjust damage breakdown in damageDetail proportionally if present
  if (Array.isArray(damageItem.damageDetail) && damageItem.damageDetail.length > 0 && incomingDamage > 0) {
    const ratio = newCasterDamage / incomingDamage;
    for (const detail of damageItem.damageDetail) {
      if (typeof detail.value === "number") {
        detail.value = Math.round(detail.value * ratio);
      }
    }
  }

  // Process necrotic damage transfer directly to each tethered target's HP
  for (const effect of casterEffects) {
    const targetTokenId = effect.getFlag(MODULE_ID, "targetTokenId");
    const targetToken = canvas.tokens.get(targetTokenId);
    if (!targetToken || !targetToken.actor) continue;

    // Apply the damage directly so HP is actually deducted from the target
    await applyDirectDamage(targetToken, transferDamage, "necrotic");

    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token }),
      content: `
        <div class="dnd5e chat-card">
          <header class="card-header flexrow">
            <h3 class="item-name">⚡ Life Tether Schadensübertragung</h3>
          </header>
          <div class="card-content">
            <p><b>${token.name}</b> erleidet <b>${newCasterDamage}</b> Schaden (50% von ${incomingDamage} abgewehrt).</p>
            <p><b>${transferDamage}</b> nekrotischer Schaden (50%) wird über den Tether auf <b>${targetToken.name}</b> übertragen!</p>
          </div>
        </div>
      `
    });
  }

  return true;
});

/**
 * 3. Fallback for Manual Damage Application: dnd5e.preApplyDamage
 * Catches direct damage applied outside Midi-QOL workflows (e.g. manual sheet or token adjustments).
 */
Hooks.on("dnd5e.preApplyDamage", (actor, amount, updates, options) => {
  // If Midi-QOL is handling the workflow, skip to prevent double modification
  if (options?.midi) return;
  if (options?.[MODULE_ID]?.isDamageTransfer) return;

  const casterEffects = actor.effects.filter(e =>
    !e.disabled && e.getFlag(MODULE_ID, "isCaster")
  );
  if (casterEffects.length === 0) return;

  const totalDamage = typeof amount === "number" ? amount : 0;
  if (totalDamage <= 0) return;

  const transferDamage = Math.floor(totalDamage * 0.5);
  if (transferDamage <= 0) return;

  const newCasterDamage = totalDamage - transferDamage;
  const hpReduction = totalDamage - newCasterDamage;

  if (updates["system.attributes.hp.value"] !== undefined) {
    updates["system.attributes.hp.value"] = Math.min(
      actor.system.attributes.hp.max,
      updates["system.attributes.hp.value"] + hpReduction
    );
  }

  // Also apply damage to tethered target in direct manual mode
  for (const effect of casterEffects) {
    const targetTokenId = effect.getFlag(MODULE_ID, "targetTokenId");
    const targetToken = canvas.tokens.get(targetTokenId);
    if (targetToken) {
      applyDirectDamage(targetToken, transferDamage, "necrotic");
    }
  }

  console.log(`[${MODULE_ID}] dnd5e.preApplyDamage manuell abgefangen: Caster ${actor.name} Schadensreduktion von ${totalDamage} auf ${newCasterDamage}.`);
});

/**
 * 4. Line-of-Sight Check: updateToken
 * Checks sight collision between tethered tokens whenever either moves.
 */
Hooks.on("updateToken", (tokenDocument, change, options, userId) => {
  if (change.x === undefined && change.y === undefined) return;

  // Execute only once per move (moving user or active GM)
  if (game.user.id !== userId && !game.user.isGM) return;
  if (game.user.id !== userId && game.users.get(userId)?.active) return;

  const token = tokenDocument.object ?? canvas.tokens.get(tokenDocument.id);
  if (!token || !token.actor) return;

  const tetherEffects = token.actor.effects.filter(e =>
    !e.disabled && e.flags?.[MODULE_ID]
  );
  if (tetherEffects.length === 0) return;

  for (const effect of tetherEffects) {
    const flagData = effect.flags[MODULE_ID];
    const otherTokenId = flagData.isCaster ? flagData.targetTokenId : flagData.casterTokenId;
    const otherToken = canvas.tokens.get(otherTokenId);
    if (!otherToken) continue;

    const pairKey = [token.id, otherToken.id].sort().join("-");
    const ray = new Ray(token.center, otherToken.center);

    let hasSightCollision = false;
    if (CONFIG.Canvas?.polygonBackends?.sight) {
      hasSightCollision = Boolean(CONFIG.Canvas.polygonBackends.sight.testCollision(ray.A, ray.B, { mode: "any", type: "sight" }));
    } else if (canvas.walls?.checkCollision) {
      hasSightCollision = Boolean(canvas.walls.checkCollision(ray, { type: "sight" }));
    }

    const wasBlocked = losWarningTracker.get(pairKey) ?? false;

    if (hasSightCollision && !wasBlocked) {
      losWarningTracker.set(pairKey, true);
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token }),
        content: `
          <div class="dnd5e chat-card">
            <div class="card-content">
              <p style="color: #b00020;"><strong>⚠️ Life Tether: Sichtlinie unterbrochen!</strong></p>
              <p>Die Sichtlinie zwischen <b>${token.name}</b> und <b>${otherToken.name}</b> wird durch eine Wand blockiert!</p>
            </div>
          </div>
        `
      });
    } else if (!hasSightCollision && wasBlocked) {
      losWarningTracker.set(pairKey, false);
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token }),
        content: `
          <div class="dnd5e chat-card">
            <div class="card-content">
              <p style="color: #007a3d;"><strong>✓ Life Tether: Sichtlinie wiederhergestellt.</strong></p>
              <p>Die Sichtlinie zwischen <b>${token.name}</b> und <b>${otherToken.name}</b> ist wieder frei.</p>
            </div>
          </div>
        `
      });
    }
  }
});

/**
 * 5. Cleanup on Effect Deletion: deleteActiveEffect
 * Cleanly ends Sequencer effects and removes paired active effect if one side is removed.
 */
Hooks.on("deleteActiveEffect", async (effect, options, userId) => {
  // Only GM client performs the cleanup to prevent duplicate calls across clients
  if (!game.user.isGM && game.users.some(u => u.isGM && u.active)) return;

  const flagData = effect.flags?.[MODULE_ID];
  if (!flagData) return;

  const { casterTokenId, targetTokenId, effectTag } = flagData;
  const tag = effectTag || `life-tether-${casterTokenId}-${targetTokenId}`;

  // End Sequencer visual beam cleanly
  if (game.modules.get("sequencer")?.active && typeof Sequencer !== "undefined") {
    Sequencer.EffectManager.endEffects({ name: tag });
  }

  // Clear LoS tracker for this pair
  const pairKey = [casterTokenId, targetTokenId].sort().join("-");
  losWarningTracker.delete(pairKey);

  // Remove corresponding paired effect on the other token
  const otherTokenId = flagData.isCaster ? targetTokenId : casterTokenId;
  const otherToken = canvas.tokens.get(otherTokenId);
  if (otherToken?.actor) {
    const pairedEffects = otherToken.actor.effects.filter(e =>
      e.flags?.[MODULE_ID]?.casterTokenId === casterTokenId &&
      e.flags?.[MODULE_ID]?.targetTokenId === targetTokenId &&
      e.id !== effect.id
    );

    for (const paired of pairedEffects) {
      await removeEffectSafely(otherToken.actor, paired.id);
    }
  }

  const casterToken = canvas.tokens.get(casterTokenId);
  const targetToken = canvas.tokens.get(targetTokenId);
  const casterName = casterToken?.name ?? "Zaubernder";
  const targetName = targetToken?.name ?? "Ziel";

  ChatMessage.create({
    content: `
      <div class="dnd5e chat-card">
        <div class="card-content">
          <p><strong>Life Tether beendet:</strong> Die Verbindung zwischen <b>${casterName}</b> und <b>${targetName}</b> wurde getrennt.</p>
        </div>
      </div>
    `
  });
});
