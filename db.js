// db.js
require('dotenv').config();
const { Pool } = require('pg');

// Configurações de conexão com o banco de dados
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Importante para ambientes de desenvolvimento como Render, se estiver usando SSL. Para produção, pode ser true se tiver um certificado válido.
    }
});

// Função para conectar e criar a tabela de contatos se não existir
async function connectAndCreateContactsTable() {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS contacts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL
            );
        `);
        client.release();
        console.log('Tabela "contacts" verificada/criada com sucesso.');
    } catch (err) {
        console.error('Erro ao conectar ou criar tabela de contatos:', err);
        // Re-throw para garantir que o erro seja capturado e o app não inicie com DB problemático
        throw err;
    }
}

// Função para adicionar um novo contato ou atualizar se o nome já existir
async function addContact(name, email) {
    try {
        const result = await pool.query(
            'INSERT INTO contacts (name, email) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET email = EXCLUDED.email RETURNING *;',
            [name, email]
        );
        console.log('Contato adicionado/atualizado:', result.rows[0]);
        return result.rows[0];
    } catch (err) {
        console.error('Erro ao adicionar/atualizar contato:', err);
        throw err;
    }
}

// Função para buscar um email pelo nome
async function getEmailByName(name) {
    try {
        // Usamos ILIKE para busca case-insensitive
        const result = await pool.query('SELECT email FROM contacts WHERE name ILIKE $1;', [name]);
        return result.rows.length > 0 ? result.rows[0].email : null;
    } catch (err) {
        console.error('Erro ao buscar email por nome:', err);
        throw err;
    }
}

// Exporta as funções para serem usadas em outros arquivos
module.exports = {
    connectAndCreateContactsTable,
    addContact,
    getEmailByName
};