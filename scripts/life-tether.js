/**
 * Life Tether Module for Foundry VTT (D&D 5e)
 *
 * Automates the "Life Tether" spell:
 * - Upcasting target validation (Levels 2, 4, 6, 8)
 * - Saving throw validation via Midi-QOL
 * - Dynamic visual beam using Sequencer & JB2A
 * - 50% necrotic damage transfer from caster to tethered target(s)
 * - Line-of-sight tracking via wall collision detection
 * - Clean cleanup of effects and visuals on effect expiration/deletion
 */

const MODULE_ID = "life-tether-spell";
const SPELL_NAME = "Life Tether";

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
 * 1. Spell Cast & Target Assignment: midi-qol.RollComplete
 * Triggers after the spell roll and saves have completed.
 */
Hooks.on("midi-qol.RollComplete", async (workflow) => {
  if (!workflow.item) return;

  const itemName = workflow.item.name?.trim().toLowerCase();
  const isLifeTether = itemName === SPELL_NAME.toLowerCase() ||
    Boolean(workflow.item.flags?.[MODULE_ID]?.isLifeTether);

  if (!isLifeTether) return;

  const casterToken = workflow.token;
  const casterActor = workflow.actor;
  if (!casterToken || !casterActor) return;

  // Upcasting calculation:
  // Level 2 -> 1 target
  // Level 4 -> 2 targets
  // Level 6 -> 3 targets
  // Level 8 -> 4 targets
  const castLevel = workflow.castData?.castLevel ?? workflow.item.system?.level ?? 2;
  const maxTargets = 1 + Math.max(0, Math.floor((castLevel - 2) / 2));

  // Determine valid targets based on failed saves
  let validTargets = [];
  if (workflow.failedSaves && workflow.failedSaves.size > 0) {
    validTargets = Array.from(workflow.failedSaves);
  } else if (workflow.saves && workflow.saves.size > 0) {
    // If saves were made but none failed:
    validTargets = [];
  } else if (workflow.targets && workflow.targets.size > 0) {
    // Fallback if saves are handled outside automated workflow
    validTargets = Array.from(workflow.targets);
  }

  if (validTargets.length === 0) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: casterToken }),
      content: `
        <div class="dnd5e chat-card">
          <header class="card-header flexrow">
            <img src="${workflow.item.img}" title="${workflow.item.name}" width="36" height="36"/>
            <h3 class="item-name">${workflow.item.name}</h3>
          </header>
          <div class="card-content">
            <p><strong>Kein Ziel angebunden.</strong> Alle Ziele haben ihren Rettungswurf bestanden oder es wurden keine Ziele gewählt.</p>
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
            <p><em>Hinweis zu ${workflow.item.name}:</em> Bei Zaubergrad ${castLevel} können maximal <b>${maxTargets}</b> Ziel(e) gebunden werden. Die ersten ${maxTargets} fehlgeschlagenen Ziele werden angebunden.</p>
          </div>
        </div>
      `
    });
    validTargets = validTargets.slice(0, maxTargets);
  }

  const spellDurationSeconds = 60; // 1 minute default
  const spellDurationRounds = 10;

  for (const targetToken of validTargets) {
    const targetActor = targetToken.actor;
    if (!targetActor) continue;

    const effectTag = `life-tether-${casterToken.id}-${targetToken.id}`;

    // 1. Create Active Effect on Target
    const targetEffectData = {
      name: `Life Tethered (${casterToken.name})`,
      icon: workflow.item.img || "icons/magic/death/hand-dirt-undead-zombie.webp",
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
    await targetActor.createEmbeddedDocuments("ActiveEffect", [targetEffectData]);

    // 2. Create Active Effect on Caster
    const casterEffectData = {
      name: `Life Tether (${targetToken.name})`,
      icon: workflow.item.img || "icons/magic/death/hand-dirt-undead-zombie.webp",
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
    await casterActor.createEmbeddedDocuments("ActiveEffect", [casterEffectData]);

    // 3. Sequencer Visual Beam
    if (game.modules.get("sequencer")?.active && typeof Sequence !== "undefined") {
      // Clean up any existing effect with this tag first
      Sequencer.EffectManager.endEffects({ name: effectTag });

      // Determine beam asset: prefer JB2A green energy beam / ray of enfeeblement
      let beamFile = "jb2a.energy_beam.normal.green";
      if (typeof Sequencer.Database?.entryExists === "function") {
        if (!Sequencer.Database.entryExists(beamFile)) {
          beamFile = "jb2a.ray_of_enfeeblement.green";
        }
      }

      new Sequence()
        .effect()
          .file(beamFile)
          .attachTo(casterToken)
          .stretchTo(targetToken)
          .persist()
          .name(effectTag)
        .play();
    }

    // 4. Chat Confirmation
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: casterToken }),
      content: `
        <div class="dnd5e chat-card">
          <header class="card-header flexrow">
            <img src="${workflow.item.img}" title="${workflow.item.name}" width="36" height="36"/>
            <h3 class="item-name">${workflow.item.name} aktiviert!</h3>
          </header>
          <div class="card-content">
            <p>Ein nekrotischer Lebensfaden verbindet <b>${casterToken.name}</b> mit <b>${targetToken.name}</b>.</p>
            <p><em>Wirkung:</em> 50% des Schadens, den ${casterToken.name} erleidet, wird direkt als nekrotischer Schaden auf ${targetToken.name} übertragen.</p>
          </div>
        </div>
      `
    });
  }
});

/**
 * 2. Damage Redirection: midi-qol.DamageRollComplete
 * Intercepts incoming damage on the caster and transfers 50% (rounded down) as necrotic damage to tethered target(s).
 */
Hooks.on("midi-qol.DamageRollComplete", async (workflow) => {
  // Prevent infinite loops if our own transfer damage is being rolled
  if (workflow.item?.flags?.[MODULE_ID]?.isDamageTransfer) return;

  const hitTokens = workflow.hitTargets ? Array.from(workflow.hitTargets) : [];
  if (hitTokens.length === 0) return;

  for (const token of hitTokens) {
    const actor = token.actor;
    if (!actor) continue;

    // Check if this token is a Caster with active Life Tether
    const casterEffects = actor.effects.filter(e =>
      !e.disabled && e.flags?.[MODULE_ID]?.isCaster
    );
    if (casterEffects.length === 0) continue;

    // Calculate total damage dealt to the caster
    let damageTaken = 0;
    if (workflow.damageList && workflow.damageList.length > 0) {
      const entry = workflow.damageList.find(d => d.tokenId === token.id || d.tokenUuid === token.document.uuid);
      if (entry) {
        damageTaken = entry.appliedDamage ?? entry.hpDamage ?? entry.totalDamage ?? 0;
      }
    }

    if (damageTaken <= 0 && workflow.damageRoll) {
      damageTaken = workflow.damageRoll.total ?? 0;
    }

    if (damageTaken <= 0) continue;

    // Calculate 50% rounded down
    const transferDamage = Math.floor(damageTaken * 0.5);
    if (transferDamage <= 0) continue;

    for (const effect of casterEffects) {
      const targetTokenId = effect.flags[MODULE_ID]?.targetTokenId;
      const targetToken = canvas.tokens.get(targetTokenId);
      if (!targetToken || !targetToken.actor) continue;

      const targetActor = targetToken.actor;

      // Apply direct necrotic damage
      if (globalThis.MidiQOL?.DamageOnlyWorkflow) {
        const damageRoll = await new Roll(`${transferDamage}`).evaluate({ async: true });
        new MidiQOL.DamageOnlyWorkflow(
          actor,
          token,
          transferDamage,
          "necrotic",
          [targetToken],
          damageRoll,
          {
            flavor: `Life Tether Übertragung (50% von ${damageTaken} Schaden)`,
            itemCardId: "new",
            itemData: {
              name: "Life Tether Übertragung",
              type: "feat",
              img: "icons/magic/death/hand-dirt-undead-zombie.webp",
              flags: {
                [MODULE_ID]: { isDamageTransfer: true }
              }
            }
          }
        );
      } else if (typeof targetActor.applyDamage === "function") {
        await targetActor.applyDamage([{ value: transferDamage, type: "necrotic" }]);
      } else {
        const currentHp = targetActor.system.attributes.hp.value;
        await targetActor.update({ "system.attributes.hp.value": Math.max(0, currentHp - transferDamage) });
      }

      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: token }),
        content: `
          <div class="dnd5e chat-card">
            <header class="card-header flexrow">
              <h3 class="item-name">⚡ Life Tether Schadensübertragung</h3>
            </header>
            <div class="card-content">
              <p><b>${token.name}</b> hat <b>${damageTaken}</b> Schaden erlitten.</p>
              <p><b>${transferDamage}</b> nekrotischer Schaden (50%) wird über den Tether auf <b>${targetToken.name}</b> übertragen!</p>
            </div>
          </div>
        `
      });
    }
  }
});

/**
 * 3. Line-of-Sight Check: updateToken
 * Checks sight collision between tethered tokens whenever either moves.
 */
Hooks.on("updateToken", (tokenDocument, change, options, userId) => {
  // Position must have changed
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

    // Collision check: works on Foundry v11 and v12
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
      // Sight restored
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
 * 4. Cleanup on Effect Deletion: deleteActiveEffect
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
      await paired.delete();
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
