// ═══════════════════════════════════════════════════════════════
// rpg-system.js — Agent RPG Progression System
// ═══════════════════════════════════════════════════════════════
// Tracks XP, levels, achievements, skills for AI agents
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RPG_FILE = join(__dirname, 'agent-rpg-stats.json');

class RPGSystem {
    constructor() {
        this.stats = this.loadStats();
    }

    loadStats() {
        try {
            if (existsSync(RPG_FILE)) {
                return JSON.parse(readFileSync(RPG_FILE, 'utf8'));
            }
        } catch (e) {
            console.error('[RPG] Failed to load stats:', e);
        }
        return null;
    }

    saveStats() {
        try {
            writeFileSync(RPG_FILE, JSON.stringify(this.stats, null, 2));
        } catch (e) {
            console.error('[RPG] Failed to save stats:', e);
        }
    }

    getAgentStats(agentId) {
        if (!this.stats || !this.stats.agents) return null;
        return this.stats.agents[agentId] || null;
    }

    getAllStats() {
        return this.stats;
    }

    awardXP(agentId, amount, reason = 'unknown') {
        if (!this.stats || !this.stats.agents || !this.stats.agents[agentId]) {
            console.warn(`[RPG] Agent ${agentId} not found`);
            return null;
        }

        const agent = this.stats.agents[agentId];
        agent.xp += amount;
        agent.totalXp += amount;

        console.log(`[RPG] ${agentId} gained ${amount} XP (${reason}) — ${agent.xp}/${agent.xpToNext}`);

        // Check for level up
        const leveledUp = this.checkLevelUp(agentId);
        
        this.saveStats();

        return {
            xpGained: amount,
            currentXp: agent.xp,
            xpToNext: agent.xpToNext,
            level: agent.level,
            leveledUp,
            reason
        };
    }

    checkLevelUp(agentId) {
        const agent = this.stats.agents[agentId];
        if (!agent) return false;

        let leveledUp = false;

        while (agent.xp >= agent.xpToNext) {
            agent.xp -= agent.xpToNext;
            agent.level += 1;
            leveledUp = true;

            // Calculate next level XP requirement
            const curve = this.stats.levelCurve;
            agent.xpToNext = Math.floor(curve.base * Math.pow(agent.level, curve.multiplier));

            // Apply stat increases
            this.applyStatBoosts(agentId);

            // Check for level benefits
            this.checkLevelBenefits(agentId);

            console.log(`[RPG] 🎉 ${agentId} leveled up to ${agent.level}! Next: ${agent.xpToNext} XP`);
        }

        if (leveledUp) {
            this.saveStats();
        }

        return leveledUp;
    }

    applyStatBoosts(agentId) {
        const agent = this.stats.agents[agentId];
        if (!agent) return;

        // +1 to all stats every level
        agent.stats.intelligence += 1;
        agent.stats.speed += 1;
        agent.stats.stamina += 1;
        agent.stats.wisdom += 1;
        agent.stats.charisma += 1;

        // Specialization bonuses every 5 levels
        if (agent.level % 5 === 0) {
            switch (agent.specialization) {
                case 'orchestrator':
                    agent.stats.charisma += 3;
                    agent.stats.intelligence += 2;
                    break;
                case 'infrastructure':
                    agent.stats.stamina += 3;
                    agent.stats.wisdom += 2;
                    break;
                case 'analyst':
                    agent.stats.intelligence += 3;
                    agent.stats.wisdom += 2;
                    break;
            }
        }
    }

    checkLevelBenefits(agentId) {
        const agent = this.stats.agents[agentId];
        if (!agent) return;

        const benefits = this.stats.levelBenefits[agent.level];
        if (benefits) {
            console.log(`[RPG] 🎁 ${agentId} unlocked: ${benefits.description}`);
            
            // Apply stat boosts if any
            if (benefits.stat_boost) {
                for (const [stat, boost] of Object.entries(benefits.stat_boost)) {
                    agent.stats[stat] += boost;
                }
            }
        }
    }

    awardAchievement(agentId, achievementId) {
        const agent = this.stats.agents[agentId];
        if (!agent) return;

        // Check if already earned
        if (agent.achievements.includes(achievementId)) {
            return null;
        }

        // Find achievement
        const achievement = this.stats.achievements.find(a => a.id === achievementId);
        if (!achievement) {
            console.warn(`[RPG] Achievement ${achievementId} not found`);
            return null;
        }

        // Award achievement
        agent.achievements.push(achievementId);
        console.log(`[RPG] 🏆 ${agentId} earned: ${achievement.name} (+${achievement.xpReward} XP)`);

        // Award XP
        const xpResult = this.awardXP(agentId, achievement.xpReward, `achievement: ${achievement.name}`);

        this.saveStats();

        return {
            achievement,
            xpResult
        };
    }

    // Helper methods for common XP awards
    onCommandSuccess(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.commandSuccess, 'command success');
    }

    onFileCreated(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.fileCreated, 'file created');
    }

    onFileEdited(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.fileEdited, 'file edited');
    }

    onGitCommit(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.gitCommit, 'git commit');
    }

    onProjectCompletion(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.projectCompletion, 'project completion');
    }

    onHeartbeat(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.heartbeatCheck, 'heartbeat check');
    }

    onProactiveAction(agentId) {
        return this.awardXP(agentId, this.stats.xpRates.proactiveAction, 'proactive action');
    }
}

export default new RPGSystem();
