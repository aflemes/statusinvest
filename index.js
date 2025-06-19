require('dotenv').config();

const express = require('express');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL); // padrão: localhost:6379
const app = express();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const PORT = process.env.PORT || 3000;
const fiiList = ["HGRU11", "HSML11", "BRCO11", "LVBI11", "PVBI11", "HGLG11", "TRXF11", "BTLG11", "XPML11", "HGCR11", "KNCR11", "MXRF11", "VRTA11", "RECR11", "CPTS11", "VGHF11", "TGAR11"]

puppeteer.use(StealthPlugin());

async function scrapeStatusInvestDividendos() {
    const browser = await puppeteer.launch({
        headless: "new", // ou true
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage', // evita problemas de memória compartilhada
            '--single-process',
            '--no-zygote']
    });
    
    for (var index = 0; index < fiiList.length; index++){        
        const fiiCode = fiiList[index];
        const cacheKey = `si_dividendos:${fiiCode}`;
        
        console.log(`Buscando dividendos do Status Invest para FII: ${fiiCode}`);

        const url = `https://statusinvest.com.br/fundos-imobiliarios/${fiiCode}`;
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded'});
            const html = await page.content();
            await page.waitForSelector('#earning-section');            
            const dividendosData = await page.evaluate(() => {
                // Seleciona a tabela de dividendos dentro de earning-section
                const table = document.querySelector('div#earning-section table');
                if (!table) return null;
                
                // Extrai os cabeçalhos da tabela
                const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText.trim());
                
                // Extrai os dados de cada linha
                const rows = Array.from(table.querySelectorAll('tbody tr')).map(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const rowData = {};
                    
                    cells.forEach((cell, index) => {
                        if (headers[index]) {
                            rowData[headers[index]] = cell.innerText.trim();
                        }
                    });
                    
                    return rowData;
                });
                
                return rows;
            });
    
            if (!dividendosData) {
                console.log(`Não foi possível encontrar a tabela de dividendos para ${fiiCode}`);
                continue;
            }            
            
            const dividendoInfo = dividendosData?.length > 0 ? dividendosData[0] : null;
            
            // Converte vírgulas para pontos nos valores numéricos
            if (dividendoInfo && dividendoInfo["VALOR"]) {
                dividendoInfo["VALOR"] = dividendoInfo["VALOR"].replace(",", ".");
            }
                
            // Salva no Redis (TTL de 10 dias = 864000 segundos)
            await redis.set(cacheKey, JSON.stringify(dividendoInfo), 'EX', 864000);
            console.log(`Dados de dividendos do Status Invest salvos para ${fiiCode}: ${dividendosData.length} registros`);
        } 
        catch (err) {
            console.log(`Erro ao obter os dividendos do Status Invest para ${fiiCode}: ${err.message}`);
        }
        finally{
            await page.close();
        }
    }

    await browser.close();
    const browserProcess = browser.process();
    if (browserProcess) browserProcess.kill('SIGKILL'); // força encerramento
}

app.get('/dividendos/:fiiCode', async (req, res) => {
    const fiiCode = req.params.fiiCode.toUpperCase();
    const cacheKey = `si_dividendos:${fiiCode}`;
    
    try {
        const detalhes = JSON.parse(await redis.get(cacheKey));
        if (detalhes == null)
            return res.status(404).json({ error: 'Nenhuma informação encontrada para esse FII.' });
        
        let value = detalhes["VALOR"];
        
        res.send(value);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/dividendos/data/com/:fiiCode', async (req, res) => {
    const fiiCode = req.params.fiiCode.toUpperCase();
    const cacheKey = `si_dividendos:${fiiCode}`;
    
    try {
        const dividendos = JSON.parse(await redis.get(cacheKey));
        if (dividendos == null)
            return res.status(404).json({ error: 'Nenhuma informação encontrada para esse FII.' });
        
        let value = dividendos["DATA COM"];

        res.send(value);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/dividendos/data/pgto/:fiiCode', async (req, res) => {
    const fiiCode = req.params.fiiCode.toUpperCase();
    const cacheKey = `si_dividendos:${fiiCode}`;

    try {
        const dividendos = JSON.parse(await redis.get(cacheKey));
        
        if (dividendos == null)
            return res.status(404).json({ error: 'Nenhuma informação encontrada para esse FII.' });
        let value = dividendos["PAGAMENTO"];

        res.send(value);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/dividendos/', async (req, res) => {    
    const detalhes = await scrapeStatusInvestDividendos(fiiList);        
    res.send(true);    
});

app.listen(PORT, () => {
    console.log(`API rodando em ${PORT}`);
});
