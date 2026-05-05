const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://ohkessuokmozfwldmqgs.supabase.co';
// The full anon key provided by the user
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9oa2Vzc3Vva21vemZ3bGRtcWdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NTcwNDIsImV4cCI6MjA5MzQzMzA0Mn0._bfAZ6qAbqqqsdw8-O-hTl5ZtCenZ3Kj0jVMFbVNK7w';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkProject() {
    console.log('Checking Supabase project with full key...');
    
    // Check tables in public schema
    const { data: tables, error: tableError } = await supabase
        .from('config') 
        .select('*');

    if (tableError) {
        console.log('Config table check result:', tableError.message);
    } else {
        console.log('Found config table data:', tables);
    }

    // Try to get all tables if possible (requires more permissions usually)
    // But we can try to see if there's any other common table
}

checkProject();
