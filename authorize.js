// authorize.js
// Este script serve apenas para fazer a autenticação com o Google uma única vez.
const { authorize } = require('./googleCalendar');

console.log('Iniciando o processo de autorização...');
console.log('Uma aba do seu navegador será aberta em breve...');

authorize().then(() => {
    console.log('-------------------------------------------------------------------');
    console.log('✅ Autorização concluída com sucesso! O arquivo token.json foi criado.');
    console.log('Agora você pode rodar o servidor principal com "node index.js".');
    console.log('-------------------------------------------------------------------');
    //process.exit(); // Encerra o script de autorização
}).catch(console.error);
